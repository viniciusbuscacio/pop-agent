import { execFile } from 'node:child_process';
import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type {
  ExtensionContext,
  LoadExtensionsResult,
  ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

const SUBAGENT_CONFIG = {
  asyncByDefault: false,
  defaultSubagentContext: 'fresh',
  fleetView: false,
  asyncWidget: false,
  waitTool: false,
  maxSubagentDepth: 1,
  maxSubagentSpawnsPerSession: 20,
  maxSubagentSpawnsPerRun: 1,
  maxActiveAsyncRunsPerSession: 1,
  globalConcurrencyLimit: 1,
  parallel: { maxTasks: 1, concurrency: 1 },
  scheduledRuns: { enabled: false, maxPending: 0 },
} as const;

const WORKER_TIMEOUT_MS = 30 * 60 * 1_000;
const WORKER_TOOL_BUDGET = 80;
const MAX_PATCH_BYTES = 16 * 1_024 * 1_024;
const execFileAsync = promisify(execFile);

export interface WorkerSubagentRuntimeOptions {
  extensionPath: string;
  agentDir: string;
  authPath: string;
  piBinary: string;
}

/**
 * pi-subagents is loaded explicitly, never through ambient ~/.pi discovery.
 * Its child CLI expects pi's conventional agent directory, so the only shared
 * state is a link to Pop's isolated OAuth store. API-key credentials stay in
 * Pop's in-memory runtime and are deliberately not copied to disk.
 */
export function prepareWorkerSubagentRuntime(options: WorkerSubagentRuntimeOptions): void {
  const configPath = join(options.agentDir, 'extensions', 'subagent', 'config.json');
  mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
  writeFileSync(configPath, `${JSON.stringify(SUBAGENT_CONFIG, null, 2)}\n`, { mode: 0o600 });

  const childAuthPath = join(options.agentDir, 'auth.json');
  let stat: ReturnType<typeof lstatSync> | undefined;
  try {
    stat = lstatSync(childAuthPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  if (stat === undefined) {
    mkdirSync(dirname(options.authPath), { recursive: true, mode: 0o700 });
    symlinkSync(relative(options.agentDir, options.authPath), childAuthPath);
  } else if (
    !stat.isSymbolicLink() ||
    resolve(options.agentDir, readlinkSync(childAuthPath)) !== resolve(options.authPath)
  ) {
    throw new Error(`Worker subagent auth path is not Pop's isolated auth store: ${childAuthPath}`);
  }

  process.env.PI_CODING_AGENT_DIR = options.agentDir;
  process.env.PI_SUBAGENT_PI_BINARY = options.piBinary;
  process.env.PI_SUBAGENT_TASK_DELIVERY = 'file';
}

export function extensionToolNames(
  result: LoadExtensionsResult,
  extensionPath: string,
): string[] {
  const expected = resolve(extensionPath);
  const extension = result.extensions.find(
    (entry) => resolve(entry.resolvedPath) === expected || resolve(entry.path) === expected,
  );
  if (extension === undefined) {
    const diagnostic = result.errors.map((entry) => entry.error).join('; ');
    throw new Error(`pi-subagents failed to load${diagnostic.length === 0 ? '' : `: ${diagnostic}`}`);
  }
  return [...extension.tools.keys()];
}

export function withoutExtensionTools(
  activeToolNames: readonly string[],
  extensionNames: readonly string[],
): string[] {
  const hidden = new Set(extensionNames);
  return activeToolNames.filter((name) => !hidden.has(name));
}

interface UnderlyingSubagentTool {
  execute: ToolDefinition['execute'];
}

interface PreparedWorkerWorktree {
  repository: string;
  baseCommit: string;
  root: string;
  worktree: string;
}

interface WorkerHandoff {
  repository: string;
  baseCommit: string;
  patchPath: string;
  manifestPath: string;
  patchBytes: number;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_PATCH_BYTES + 1_024 * 1_024,
  });
  return result.stdout.trim();
}

async function createWorkerWorktree(
  requestedRepository: string,
  toolCallId: string,
): Promise<PreparedWorkerWorktree> {
  const repository = await git(requestedRepository, ['rev-parse', '--show-toplevel']);
  const baseCommit = await git(repository, ['rev-parse', 'HEAD']);
  const safeId = toolCallId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 48) || 'run';
  const root = mkdtempSync(join(tmpdir(), `pop-worker-${safeId}-`));
  const worktree = join(root, 'worktree');
  await git(repository, ['worktree', 'add', '--detach', worktree, baseCommit]);
  return { repository, baseCommit, root, worktree };
}

async function captureWorkerHandoff(prepared: PreparedWorkerWorktree): Promise<WorkerHandoff> {
  try {
    await git(prepared.worktree, ['add', '--intent-to-add', '--all']);
  } catch {
    // A repository with ignored/unrepresentable files can still yield its tracked diff.
  }
  const diff = await execFileAsync(
    'git',
    ['-C', prepared.worktree, 'diff', '--binary', prepared.baseCommit, '--'],
    { encoding: 'utf8', maxBuffer: MAX_PATCH_BYTES + 1_024 * 1_024 },
  );
  const patch = diff.stdout;
  const patchBytes = Buffer.byteLength(patch);
  if (patchBytes > MAX_PATCH_BYTES) throw new Error('Worker patch exceeds the 16 MiB handoff limit');
  const patchPath = join(prepared.root, 'worker.patch');
  const manifestPath = join(prepared.root, 'handoff.json');
  writeFileSync(patchPath, patch, { mode: 0o600 });
  const handoff: WorkerHandoff = {
    repository: prepared.repository,
    baseCommit: prepared.baseCommit,
    patchPath,
    manifestPath,
    patchBytes,
  };
  writeFileSync(manifestPath, `${JSON.stringify(handoff, null, 2)}\n`, { mode: 0o600 });
  return handoff;
}

async function removeWorkerWorktree(prepared: PreparedWorkerWorktree): Promise<void> {
  try {
    await git(prepared.repository, ['worktree', 'remove', '--force', prepared.worktree]);
  } finally {
    try {
      await git(prepared.repository, ['worktree', 'prune']);
    } catch {
      // Cleanup is best effort after the patch and manifest have been captured.
    }
  }
}

/**
 * A narrow Pop-owned facade over pi-subagents. The model cannot select another
 * agent, disable worktree isolation, run in the background, or increase any
 * execution budget. The upstream extension owns the worker run while Pop owns
 * worktree creation, patch capture and cleanup around it.
 */
export function buildDelegateWorkerTool(
  defineTool: (tool: ToolDefinition) => ToolDefinition,
  subagent: UnderlyingSubagentTool,
  options: {
    oauthReady: () => boolean;
    onUsage?: (usage: { inputTokens: number; outputTokens: number; cost: number }) => void;
  },
): ToolDefinition {
  return defineTool({
    name: 'delegate_worker',
    label: 'Worker subagent',
    description:
      'Delegate one implementation task to the pi-subagents worker in a mandatory isolated git worktree. ' +
      'Use it for substantial code changes after identifying the repository. The worker returns a handoff; ' +
      'you remain responsible for reviewing and integrating the patch, running the final repository gate, and committing. ' +
      'Not available in Plan Mode.',
    parameters: Type.Object(
      {
        repository: Type.String({
          minLength: 1,
          maxLength: 2_048,
          description: 'Absolute path to the existing git repository that should receive an isolated worker worktree.',
        }),
        task: Type.String({
          minLength: 1,
          maxLength: 32_000,
          description: 'Self-contained implementation task and acceptance criteria for the worker.',
        }),
      },
      { additionalProperties: false },
    ),
    executionMode: 'sequential',
    execute: async (toolCallId, raw, signal, onUpdate, ctx) => {
      const params = raw as { repository: string; task: string };
      if (!options.oauthReady()) {
        return {
          content: [{
            type: 'text',
            text: 'Worker delegation currently requires the selected pi OAuth/subscription credential; Pop-stored API keys are intentionally not copied into child processes.',
          }],
          details: { code: 'worker_oauth_required' },
        };
      }
      if (!params.repository.startsWith('/')) {
        return {
          content: [{ type: 'text', text: 'The worker repository must be an absolute path.' }],
          details: { code: 'worker_repository_invalid' },
        };
      }

      let handoff: WorkerHandoff | undefined;
      const prepared = await createWorkerWorktree(params.repository, toolCallId);
      try {
        const result = await subagent.execute(
          `delegate-worker-${toolCallId}`,
          {
            agent: 'worker',
            task: params.task,
            cwd: prepared.worktree,
            context: 'fresh',
            async: false,
            agentScope: 'user',
            timeoutMs: WORKER_TIMEOUT_MS,
            maxRuntimeMs: WORKER_TIMEOUT_MS,
            toolBudget: { hard: WORKER_TOOL_BUDGET, block: '*' },
            artifacts: true,
            includeProgress: true,
          },
          signal,
          onUpdate,
          ctx as ExtensionContext,
        );
        const usage = workerUsage(result.details);
        if (usage !== undefined) options.onUsage?.(usage);
        handoff = await captureWorkerHandoff(prepared);
        return {
          ...result,
          content: [
            ...result.content,
            {
              type: 'text',
              text: handoff.patchBytes === 0
                ? `Worker worktree produced no patch. Handoff manifest: ${handoff.manifestPath}`
                : `Worker patch captured (${String(handoff.patchBytes)} bytes). Review and apply it from ${handoff.patchPath}. Handoff manifest: ${handoff.manifestPath}`,
            },
          ],
          details: {
            ...(typeof result.details === 'object' && result.details !== null ? result.details : {}),
            workerHandoff: handoff,
          },
        };
      } finally {
        if (handoff === undefined) {
          try {
            handoff = await captureWorkerHandoff(prepared);
          } catch {
            // The original worker failure remains authoritative.
          }
        }
        await removeWorkerWorktree(prepared);
      }
    },
  });
}

function workerUsage(
  details: unknown,
): { inputTokens: number; outputTokens: number; cost: number } | undefined {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const total = (details as Record<string, unknown>)['totalChildUsage'];
  if (total === null || typeof total !== 'object' || Array.isArray(total)) return undefined;
  const row = total as Record<string, unknown>;
  const inputTokens = boundedNumber(row['input']);
  const outputTokens = boundedNumber(row['output']);
  const cost = boundedNumber(row['cost']);
  if (inputTokens === undefined || outputTokens === undefined || cost === undefined) return undefined;
  return { inputTokens, outputTokens, cost };
}

function boundedNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
