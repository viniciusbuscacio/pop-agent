import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  DefaultResourceLoader,
  type ExtensionContext,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  buildDelegateWorkerTool,
  extensionToolNames,
  piCliPathForSdkEntry,
  prepareWorkerSubagentRuntime,
  withoutExtensionTools,
} from './worker-subagent.js';

const define = (tool: ToolDefinition): ToolDefinition => tool;
const context = {} as ExtensionContext;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function makeRepository(): string {
  const repository = mkdtempSync(join(tmpdir(), 'pop-worker-repo-'));
  execFileSync('git', ['init', '--quiet', repository]);
  execFileSync('git', ['-C', repository, 'config', 'user.email', 'worker-test@pop.invalid']);
  execFileSync('git', ['-C', repository, 'config', 'user.name', 'Pop Worker Test']);
  writeFileSync(join(repository, 'README.md'), 'test\n');
  execFileSync('git', ['-C', repository, 'add', '.']);
  execFileSync('git', ['-C', repository, 'commit', '--quiet', '-m', 'initial']);
  return repository;
}

function workflowChildren(params: Record<string, unknown>): Array<Record<string, unknown>> {
  const script = String(params.workflowScript);
  const prefix = 'return runs.all(';
  expect(script.startsWith(prefix)).toBe(true);
  expect(script.endsWith(');')).toBe(true);
  return JSON.parse(script.slice(prefix.length, -2)) as Array<Record<string, unknown>>;
}

describe('worker subagent runtime paths', () => {
  it('finds the CLI beside bundled paths and isolated runtime file URLs', () => {
    const entry = '/runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
    const cli = '/runtime/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js';
    expect(piCliPathForSdkEntry(entry)).toBe(cli);
    expect(piCliPathForSdkEntry(pathToFileURL(entry).href)).toBe(cli);
  });
});

describe('worker subagent facade', () => {
  it('forces the upstream worker into a foreground managed worktree', async () => {
    let received: Record<string, unknown> | undefined;
    const execute: ToolDefinition['execute'] = vi.fn(async (_id, params) => {
      received = params as Record<string, unknown>;
      writeFileSync(join(String(received.cwd), 'worker-proof.txt'), 'worker-ok\n');
      return {
        content: [{ type: 'text' as const, text: 'handoff ready' }],
        details: { totalChildUsage: { input: 120, output: 45, cost: 0.004 } },
      };
    });
    const onUsage = vi.fn();
    const tool = buildDelegateWorkerTool(
      define,
      { execute },
      { oauthReady: () => true, onUsage },
    );
    const repository = makeRepository();

    const result = await tool.execute(
      'tool-1',
      { repository, task: 'Implement the bounded change.' },
      new AbortController().signal,
      undefined,
      context,
    );

    expect(result.content[0]).toEqual({ type: 'text', text: 'handoff ready' });
    expect(result.content[1]?.type === 'text' ? result.content[1].text : '').toContain(
      'patch captured',
    );
    const handoff = (result.details as { workerHandoff?: { patchPath: string } }).workerHandoff;
    expect(readFileSync(handoff?.patchPath ?? '', 'utf8')).toContain('worker-proof.txt');
    expect(execute).toHaveBeenCalledOnce();
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 120, outputTokens: 45, cost: 0.004 });
    expect(received).toMatchObject({
      agent: 'worker',
      task: 'Implement the bounded change.',
      context: 'fresh',
      async: false,
      agentScope: 'user',
      artifacts: true,
    });
    expect(received?.cwd).not.toBe(repository);
    expect(existsSync(String(received?.cwd))).toBe(false);
    expect(execFileSync('git', ['-C', repository, 'status', '--short'], { encoding: 'utf8' }))
      .toBe('');
  });

  it('launches five workers concurrently with distinct worktrees and child usage', async () => {
    let peak = 0;
    let active = 0;
    let children: Array<Record<string, unknown>> = [];
    const execute: ToolDefinition['execute'] = vi.fn(async (_id, params) => {
      children = workflowChildren(params as Record<string, unknown>);
      await Promise.all(children.map(async (child, index) => {
        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        writeFileSync(join(String(child.cwd), `worker-${String(index + 1)}.txt`), 'ok\n');
        active -= 1;
      }));
      return {
        content: [{ type: 'text' as const, text: 'parallel handoffs ready' }],
        details: {
          totalChildUsage: { input: 1_500, output: 150, cost: 0.05 },
          results: children.map((_child, index) => ({
            usage: { input: 100 + index, output: 10 + index, cost: 0.001 + index / 1_000 },
          })),
        },
      };
    });
    const onUsage = vi.fn();
    const tool = buildDelegateWorkerTool(define, { execute }, { oauthReady: () => true, onUsage });
    const repository = makeRepository();
    writeFileSync(join(repository, 'README.md'), 'source checkout change\n');
    const sourceStatus = execFileSync('git', ['-C', repository, 'status', '--short'], { encoding: 'utf8' });
    const sourceDiff = execFileSync('git', ['-C', repository, 'diff', '--binary'], { encoding: 'utf8' });
    const tasks = Array.from({ length: 5 }, (_unused, index) => `Implement slice ${String(index + 1)}.`);

    const result = await tool.execute(
      'tool-five',
      { repository, tasks },
      new AbortController().signal,
      undefined,
      context,
    );

    expect(execute).toHaveBeenCalledOnce();
    expect(peak).toBe(5);
    expect(children).toHaveLength(5);
    expect(new Set(children.map((child) => child.cwd)).size).toBe(5);
    for (const [index, child] of children.entries()) {
      expect(child).toMatchObject({
        key: `worker-${String(index + 1)}`,
        agent: 'worker',
        task: tasks[index],
        context: 'fresh',
        async: false,
        agentScope: 'user',
        timeoutMs: 1_800_000,
        maxRuntimeMs: 1_800_000,
        toolBudget: { hard: 80, block: '*' },
        artifacts: true,
        includeProgress: true,
      });
      expect(child.cwd).not.toBe(repository);
      expect(existsSync(String(child.cwd))).toBe(false);
    }
    expect(onUsage).toHaveBeenCalledTimes(5);
    expect(onUsage).not.toHaveBeenCalledWith({ inputTokens: 1_500, outputTokens: 150, cost: 0.05 });
    const handoffs = (result.details as {
      workerHandoffs: Array<{ baseCommit: string; patchPath: string; manifestPath: string }>;
    }).workerHandoffs;
    expect(handoffs).toHaveLength(5);
    expect(new Set(handoffs.map((handoff) => handoff.patchPath)).size).toBe(5);
    expect(new Set(handoffs.map((handoff) => handoff.baseCommit)).size).toBe(1);
    for (const [index, handoff] of handoffs.entries()) {
      expect(readFileSync(handoff.patchPath, 'utf8')).toContain(`worker-${String(index + 1)}.txt`);
      expect(JSON.parse(readFileSync(handoff.manifestPath, 'utf8'))).toMatchObject({
        repository,
        baseCommit: handoff.baseCommit,
        childIndex: index + 1,
      });
    }
    expect(execFileSync('git', ['-C', repository, 'status', '--short'], { encoding: 'utf8' }))
      .toBe(sourceStatus);
    expect(execFileSync('git', ['-C', repository, 'diff', '--binary'], { encoding: 'utf8' }))
      .toBe(sourceDiff);
  });

  it.each([
    ['neither task input', {}],
    ['both task inputs', { task: 'one', tasks: ['two'] }],
    ['more than five tasks', { tasks: ['1', '2', '3', '4', '5', '6'] }],
    ['an empty tasks array', { tasks: [] }],
  ])('rejects %s before creating worktrees or invoking pi-subagents', async (_label, input) => {
    const execute = vi.fn();
    const tool = buildDelegateWorkerTool(define, { execute }, { oauthReady: () => true });
    const repository = makeRepository();
    const worktreesBefore = execFileSync('git', ['-C', repository, 'worktree', 'list'], { encoding: 'utf8' });

    const result = await tool.execute(
      'tool-invalid',
      { repository, ...input },
      undefined,
      undefined,
      context,
    );

    expect(result.details).toEqual({ code: 'worker_tasks_invalid' });
    expect(execute).not.toHaveBeenCalled();
    expect(execFileSync('git', ['-C', repository, 'worktree', 'list'], { encoding: 'utf8' }))
      .toBe(worktreesBefore);
  });

  it('propagates cancellation and cleans every prepared worktree', async () => {
    let releaseStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { releaseStarted = resolve; });
    let receivedSignal: AbortSignal | undefined;
    let worktrees: string[] = [];
    const execute: ToolDefinition['execute'] = vi.fn((_id, params, signal) => {
      worktrees = workflowChildren(params as Record<string, unknown>).map((child) => String(child.cwd));
      receivedSignal = signal;
      releaseStarted?.();
      return new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new Error('child workflow aborted')), { once: true });
      });
    });
    const tool = buildDelegateWorkerTool(define, { execute }, { oauthReady: () => true });
    const repository = makeRepository();
    const controller = new AbortController();

    const running = tool.execute(
      'tool-cancel',
      { repository, tasks: ['one', 'two', 'three', 'four', 'five'] },
      controller.signal,
      undefined,
      context,
    );
    await started;
    controller.abort();

    await expect(running).rejects.toThrow('child workflow aborted');
    expect(receivedSignal).toBe(controller.signal);
    expect(worktrees).toHaveLength(5);
    expect(worktrees.every((worktree) => !existsSync(worktree))).toBe(true);
    expect(execFileSync('git', ['-C', repository, 'worktree', 'list'], { encoding: 'utf8' }))
      .not.toContain('pop-worker-tool-cancel');
    expect(execFileSync('git', ['-C', repository, 'status', '--short'], { encoding: 'utf8' }))
      .toBe('');
  });

  it('fails closed without OAuth instead of copying a Pop API key to disk', async () => {
    const execute = vi.fn();
    const tool = buildDelegateWorkerTool(define, { execute }, { oauthReady: () => false });

    const result = await tool.execute(
      'tool-2',
      { repository: '/srv/repo', task: 'Change it.' },
      undefined,
      undefined,
      context,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.details).toEqual({ code: 'worker_oauth_required' });
  });

  it('rejects a relative repository before invoking the extension', async () => {
    const execute = vi.fn();
    const tool = buildDelegateWorkerTool(define, { execute }, { oauthReady: () => true });

    const result = await tool.execute(
      'tool-3',
      { repository: 'repo', task: 'Change it.' },
      undefined,
      undefined,
      context,
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result.details).toEqual({ code: 'worker_repository_invalid' });
  });
});

describe('worker subagent runtime', () => {
  it('writes bounded policy and links only Pop isolated OAuth state', () => {
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    const previousBinary = process.env.PI_SUBAGENT_PI_BINARY;
    const previousDelivery = process.env.PI_SUBAGENT_TASK_DELIVERY;
    try {
      const root = mkdtempSync(join(tmpdir(), 'pop-worker-subagent-'));
      const agentDir = join(root, 'agent');
      const authPath = join(root, 'pi-auth.json');

      prepareWorkerSubagentRuntime({
        extensionPath: '/package/pi-subagents/index.ts',
        agentDir,
        authPath,
        piBinary: '/package/pi/dist/cli.js',
      });

      const link = join(agentDir, 'auth.json');
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe('../pi-auth.json');
      const config = JSON.parse(
        readFileSync(join(agentDir, 'extensions', 'subagent', 'config.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(config).toMatchObject({
        asyncByDefault: false,
        maxSubagentDepth: 1,
        maxSubagentSpawnsPerRun: 5,
        maxActiveAsyncRunsPerSession: 1,
        globalConcurrencyLimit: 5,
        parallel: { maxTasks: 5, concurrency: 5 },
        scheduledRuns: { enabled: false, maxPending: 0 },
      });
    } finally {
      restoreEnv('PI_CODING_AGENT_DIR', previousAgentDir);
      restoreEnv('PI_SUBAGENT_PI_BINARY', previousBinary);
      restoreEnv('PI_SUBAGENT_TASK_DELIVERY', previousDelivery);
    }
  });

  it('loads only the explicitly pinned extension and finds its hidden tools', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pop-worker-extension-'));
    const agentDir = join(root, 'agent');
    const extensionPath = createRequire(import.meta.url).resolve('pi-subagents');
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalExtensionPaths: [extensionPath],
    });

    await loader.reload();

    expect(loader.getExtensions().errors).toEqual([]);
    const hidden = extensionToolNames(loader.getExtensions(), extensionPath);
    expect(hidden).toEqual(['subagent', 'subagent_wait']);
    expect(withoutExtensionTools(['read', 'subagent', 'delegate_worker', 'subagent_wait'], hidden))
      .toEqual(['read', 'delegate_worker']);
  });
});
