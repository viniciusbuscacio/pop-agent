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
import { failLoop, LoopError, loopAbort } from '../../application/loop/loop-failure.js';
import { createLoopSnapshot } from './loop-snapshot.js';
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
      const timeout = setTimeout(() => controller.abort(new LoopError('deadline', 'prepare')), options.timeoutMs ?? 30 * 60 * 1000);
      let prepared: Awaited<ReturnType<typeof createWorkerWorktree>> | undefined;
      const evidence: LoopEvidence[] = [];
      let result: LoopResult = failLoop({ status: 'failed', summary: '', corrections: 0, evidence: [] }, undefined, 'prepare', 'preparation_failed');
      const snapshots: string[] = [];
      let handoff: Awaited<ReturnType<typeof captureWorkerHandoff>> | undefined;
      let evidencePath: string | undefined;
      try {
        controller.signal.throwIfAborted();
        const chat = options.chatModel();
        const worker = { providerId: chat.providerId, modelId: options.serviceModel(chat.providerId) };
        const runtime = await options.runtime(chat.providerId);
        if (runtime.getModel(chat.providerId, chat.modelId) === undefined || runtime.getModel(worker.providerId, worker.modelId) === undefined) {
          result = failLoop(result, undefined, 'prepare', 'preparation_failed');
        } else {
          const source = await resolveWorkerRepository(params.repository);
          controller.signal.throwIfAborted();
          prepared = await createWorkerWorktree(source.repository, source.baseCommit, `loop-${id}`, 1);
          const worktree = prepared;
          let inspection: ReturnType<typeof createLoopSnapshot> | undefined;
          const snapshot = async (phase: 'plan' | 'review', round: number): Promise<void> => {
            try {
              const captured = await captureLoopHandoff(worktree, phase);
              const files = await exec('git', ['-C', worktree.worktree, 'ls-files', '-z'], { maxBuffer: 16 * 1024 * 1024, timeout: 30_000 });
              inspection = createLoopSnapshot({ baseCommit: worktree.baseCommit, round,
                diff: readFileSync(captured.patchPath, 'utf8'), inventory: files.stdout, evidence }, phase);
              const path = join(worktree.root, `loop-snapshot-${phase}-${round}.json`);
              writeFileSync(path, inspection.serialized, { mode: 0o600 });
              snapshots.push(path);
            } catch (error) { throw error instanceof LoopError ? error : new LoopError('snapshot_failed', phase); }
          };
          const childOptions: LoopChildOptions = {
            sdk: options.sdk, runtime, agentDir: options.agentDir, cwd: worktree.worktree,
            evidence, budget: { remaining: 320 }, guard: new TaintGuard({}), onUsage: options.onUsage,
            read: (path, offset) => readLoopFile(worktree.worktree, path, offset),
            inspect: (args) => { if (!inspection) throw new LoopError('snapshot_failed', 'review'); return inspection.inspect(args); },
            inspectionComplete: () => inspection?.complete() ?? false,
          };
          let progress = '';
          let executions = 0;
          result = await runPopLoop({ child: async (request) => {
            if (request.phase === 'worker') executions += 1;
            const correction = Math.max(0, executions - 1);
            // The SDK bridge turns cumulative snapshots into append-only deltas.
            // At most nine phase entries (plan + four execution/review pairs).
            progress += `Loop: ${request.phase}${correction > 0 ? ` (correction ${String(correction)})` : ''}\n`;
            onUpdate?.({ content: [{ type: 'text', text: progress }], details: {} });
            // Capture belongs to this phase; report it before preparation can fail.
            // Read-only role tools cannot mutate even the index.
            if (request.phase !== 'worker') await snapshot(request.phase, request.round ?? 0);
            return (options.child ?? runLoopChild)(childOptions, request);
          } }, { task: params.task, chat, worker, signal: controller.signal });
        }
      } catch (error) {
        result = failLoop(result, controller.signal.aborted ? loopAbort(controller.signal, 'prepare') : error, 'prepare', 'preparation_failed');
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        if (prepared !== undefined) {
          try {
            handoff = await captureLoopHandoff(prepared, 'artifact');
          } catch (error) {
            result = failLoop(result, error, 'artifact', 'artifact_failed');
          }
          try { await removeWorkerWorktree(prepared); } catch {
            // Cleanup must neither throw away the handoff nor overwrite an earlier failure.
            if (!result.failure) result = failLoop(result, undefined, 'cleanup', 'cleanup_failed');
          }
          const path = join(prepared.root, 'loop-evidence.json');
          try {
            writeFileSync(path, JSON.stringify({ result, evidence, snapshots }, null, 2), { mode: 0o600 });
            evidencePath = path;
          } catch {
            result = failLoop(result, undefined, 'artifact', 'artifact_failed');
          }
        }
      }
      const details = { ...result, ...(handoff === undefined ? {} : { handoff }), ...(evidencePath === undefined ? {} : { evidencePath }) };
      return { content: [{ type: 'text', text: JSON.stringify(details) }], details };
    },
  });
}

async function captureLoopHandoff(prepared: Awaited<ReturnType<typeof createWorkerWorktree>>, phase: 'plan' | 'review' | 'artifact') {
  try { return await captureWorkerHandoff(prepared, 1); } catch (error) {
    const oversized = error instanceof Error && (error.message === 'Worker patch exceeds the 16 MiB handoff limit' ||
      ('code' in error && error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'));
    throw new LoopError(oversized ? 'patch_limit' : phase === 'artifact' ? 'artifact_failed' : 'snapshot_failed', phase);
  }
}
