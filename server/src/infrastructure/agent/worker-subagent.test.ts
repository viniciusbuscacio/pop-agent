import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import {
  DefaultResourceLoader,
  type ExtensionContext,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import {
  buildDelegateWorkerTool,
  extensionToolNames,
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
      'Worker patch captured',
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
        maxSubagentSpawnsPerRun: 1,
        globalConcurrencyLimit: 1,
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
