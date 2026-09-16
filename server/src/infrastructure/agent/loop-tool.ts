import { execFile } from 'node:child_process';
import { open, realpath } from 'node:fs/promises';
import { constants, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { ModelRuntime, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { runPopLoop, type LoopModel, type LoopResult } from '../../application/loop/pop-loop.js';
import type { RunUsage } from '../../application/ports/agent-bridge.js';
import { captureWorkerHandoff, createWorkerWorktree, removeWorkerWorktree, resolveWorkerRepository } from './worker-subagent.js';
import { runLoopChild, type LoopChildOptions, type LoopEvidence } from './loop-child.js';
import { TaintGuard } from './tool-taint.js';

const exec = promisify(execFile);

export async function readLoopFile(cwd: string, path: string, offset: number): Promise<string> {
  if (isAbsolute(path) || !Number.isSafeInteger(offset) || offset < 1) throw new Error('Invalid relative path or offset');
  const target = await realpath(resolve(cwd, path));
  const within = relative(await realpath(cwd), target);
  if (within === '..' || within.startsWith('../') || isAbsolute(within) || within.split('/').includes('.git')) throw new Error('Path outside Loop files');
  // Nonblocking open prevents FIFOs from hanging before fstat; NOFOLLOW closes
  // the final-component symlink race between realpath and open.
  const file = await open(target, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) throw new Error('Loop reads require a regular file under 2 MiB');
    return (await file.readFile('utf8')).split('\n').slice(offset - 1, offset + 199).join('\n').slice(0, 32_000);
  } finally { await file.close(); }
}

export interface LoopToolOptions {
  sdk: typeof import('@earendil-works/pi-coding-agent');
  agentDir: string;
  /** Read the live parent model, not the pair captured when its session opened. */
  chatModel: () => LoopModel;
  serviceModel: (providerId: string) => string;
  runtime: (providerId: string) => Promise<ModelRuntime>;
  onUsage: (usage: RunUsage & { purpose: string }) => void;
  child?: typeof runLoopChild;
  timeoutMs?: number;
}

export function buildLoopTool(options: LoopToolOptions): ToolDefinition {
  return options.sdk.defineTool({
    name: 'run_loop', label: 'Pop Loop',
    description: 'Only when the owner explicitly asks to call Loop (for example "call Loop" or "chama o Loop"): run isolated Planner/Reviewer → Worker → review, with up to three sequential corrections. Returns reviewed patch and evidence, never integrates, publishes or activates. Not for automatic complexity routing. Unavailable in Plan Mode.',
    parameters: Type.Object({
      repository: Type.String({ minLength: 1, maxLength: 2048 }),
      task: Type.String({ minLength: 1, maxLength: 32_000 }),
    }, { additionalProperties: false }),
    executionMode: 'sequential',
    execute: async (id, raw, signal, onUpdate) => {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid Loop parameters');
      const params = raw as Record<string, unknown>;
      if (typeof params.repository !== 'string' || !isAbsolute(params.repository) || params.repository.length > 2048 ||
          typeof params.task !== 'string' || params.task.trim().length === 0 || params.task.length > 32_000 ||
          Object.keys(params).some((key) => !['repository', 'task'].includes(key))) throw new Error('Loop requires only an absolute repository and a bounded task.');
      const controller = new AbortController();
      const abort = (): void => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const timeout = setTimeout(abort, options.timeoutMs ?? 30 * 60 * 1000);
      let prepared: Awaited<ReturnType<typeof createWorkerWorktree>> | undefined;
      const evidence: LoopEvidence[] = [];
      let result: LoopResult = { status: 'failed', summary: 'Loop preparation failed. Check repository and Chat/Service Model settings; no retry was attempted.', corrections: 0, evidence: [] };
      let handoff: Awaited<ReturnType<typeof captureWorkerHandoff>> | undefined;
      let evidencePath: string | undefined;
      try {
        controller.signal.throwIfAborted();
        const chat = options.chatModel();
        const worker = { providerId: chat.providerId, modelId: options.serviceModel(chat.providerId) };
        const runtime = await options.runtime(chat.providerId);
        if (runtime.getModel(chat.providerId, chat.modelId) === undefined || runtime.getModel(worker.providerId, worker.modelId) === undefined) {
          result.summary = 'Loop model unavailable. Select available Chat and Service Models for the current provider in Settings. No fallback or worker write was attempted.';
        } else {
          const source = await resolveWorkerRepository(params.repository);
          controller.signal.throwIfAborted();
          prepared = await createWorkerWorktree(source.repository, source.baseCommit, `loop-${id}`, 1);
          const worktree = prepared;
          let inspection = '';
          const snapshot = async (): Promise<string> => {
            const captured = await captureWorkerHandoff(worktree, 1);
            const files = await exec('git', ['-C', worktree.worktree, 'ls-files'], { maxBuffer: 1024 * 1024, timeout: 10_000 });
            const diff = readFileSync(captured.patchPath, 'utf8');
            if (diff.length > 100_000) throw new Error('Diff too large for Loop review; parent review required');
            const workerEvidence = JSON.stringify(evidence.filter((entry) => entry.phase === 'worker' && entry.kind !== 'answer'));
            if (workerEvidence.length > 200_000) throw new Error('Evidence too large for Loop review; parent review required');
            return JSON.stringify({ baseCommit: worktree.baseCommit, files: files.stdout.slice(0, 32_000), diff, workerEvidence });
          };
          const childOptions: LoopChildOptions = {
            sdk: options.sdk, runtime, agentDir: options.agentDir, cwd: worktree.worktree,
            evidence, budget: { remaining: 320 }, guard: new TaintGuard({}), onUsage: options.onUsage,
            read: (path, offset) => readLoopFile(worktree.worktree, path, offset),
            inspect: () => Promise.resolve(inspection),
          };
          result = await runPopLoop({ child: async (request) => {
            // Capture before entering a read-only role; its tools cannot mutate even the index.
            if (request.phase !== 'worker') inspection = await snapshot();
            onUpdate?.({ content: [{ type: 'text', text: `Loop: ${request.phase}` }], details: {} });
            return (options.child ?? runLoopChild)(childOptions, request);
          } }, { task: params.task, chat, worker, signal: controller.signal });
        }
      } catch {
        // Never return raw provider/credential errors through the tool surface.
        if (controller.signal.aborted) result = { ...result, status: 'cancelled', summary: 'Loop stopped; no replay was attempted.' };
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        if (prepared !== undefined) {
          try {
            handoff = await captureWorkerHandoff(prepared, 1);
            evidencePath = join(prepared.root, 'loop-evidence.json');
            writeFileSync(evidencePath, JSON.stringify({ result, evidence }, null, 2), { mode: 0o600 });
          } catch {
            result = { ...result, status: 'failed', summary: 'Loop artifact capture failed; do not treat this run as approved.' };
          } finally { await removeWorkerWorktree(prepared); }
        }
      }
      const details = { ...result, ...(handoff === undefined ? {} : { handoff }), ...(evidencePath === undefined ? {} : { evidencePath }) };
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    },
  });
}
