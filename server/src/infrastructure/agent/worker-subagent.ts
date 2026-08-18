import { execFile } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
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
  maxSubagentSpawnsPerRun: 5,
  maxActiveAsyncRunsPerSession: 1,
  globalConcurrencyLimit: 5,
  parallel: { maxTasks: 5, concurrency: 5 },
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

/** Resolve the CLI beside either a bundled filesystem SDK entry or an isolated file URL. */
export function piCliPathForSdkEntry(sdkEntry: string): string {
  const entryPath = sdkEntry.startsWith('file:') ? fileURLToPath(sdkEntry) : sdkEntry;
  return join(dirname(entryPath), 'cli.js');
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
  childIndex: number;
  patchPath: string;
  manifestPath: string;
  patchBytes: number;
}

interface WorkerUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_PATCH_BYTES + 1_024 * 1_024,
  });
  return result.stdout.trim();
}

async function resolveWorkerRepository(
  requestedRepository: string,
): Promise<{ repository: string; baseCommit: string }> {
  const repository = await git(requestedRepository, ['rev-parse', '--show-toplevel']);
  const baseCommit = await git(repository, ['rev-parse', 'HEAD']);
  return { repository, baseCommit };
}

async function createWorkerWorktree(
  repository: string,
  baseCommit: string,
  toolCallId: string,
  childIndex: number,
): Promise<PreparedWorkerWorktree> {
  const safeId = toolCallId.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'run';
  const root = mkdtempSync(join(tmpdir(), `pop-worker-${safeId}-${String(childIndex)}-`));
  const worktree = join(root, 'worktree');
  try {
    await git(repository, ['worktree', 'add', '--detach', worktree, baseCommit]);
  } catch (error) {
    // A failed `worktree add` can leave either a directory or a registration.
    // Remove both before reporting the preparation failure.
    try {
      await git(repository, ['worktree', 'remove', '--force', worktree]);
    } catch {
      rmSync(worktree, { recursive: true, force: true });
    }
    try {
      await git(repository, ['worktree', 'prune']);
    } catch {
      // The original preparation failure remains authoritative.
    }
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
  return { repository, baseCommit, root, worktree };
}

async function captureWorkerHandoff(
  prepared: PreparedWorkerWorktree,
  childIndex: number,
): Promise<WorkerHandoff> {
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
    childIndex,
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
  } catch {
    // Fall back to removing the directory; prune below then drops the stale
    // registration. This also covers cancellation during an in-flight child.
    rmSync(prepared.worktree, { recursive: true, force: true });
  } finally {
    try {
      await git(prepared.repository, ['worktree', 'prune']);
    } catch {
      // There is no useful recovery if Git itself cannot prune. The worktree
      // directory has still been removed above or by `worktree remove`.
    }
  }
}

async function captureAndRemoveWorkerWorktrees(
  prepared: readonly PreparedWorkerWorktree[],
): Promise<WorkerHandoff[]> {
  const handoffs: WorkerHandoff[] = [];
  let firstFailure: unknown;
  for (const [index, worktree] of prepared.entries()) {
    try {
      handoffs.push(await captureWorkerHandoff(worktree, index + 1));
    } catch (error) {
      firstFailure ??= error;
    }
    try {
      await removeWorkerWorktree(worktree);
    } catch (error) {
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) throw firstFailure;
  return handoffs;
}

function normalizedTasks(raw: unknown): { tasks?: string[]; error?: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'Worker delegation requires exactly one of task or tasks.' };
  }
  const params = raw as Record<string, unknown>;
  const hasTask = Object.prototype.hasOwnProperty.call(params, 'task');
  const hasTasks = Object.prototype.hasOwnProperty.call(params, 'tasks');
  if (hasTask === hasTasks) {
    return { error: 'Worker delegation requires exactly one of task or tasks.' };
  }
  if (hasTask) {
    if (typeof params['task'] !== 'string' || params['task'].length === 0 || params['task'].length > 32_000) {
      return { error: 'Worker task must be a non-empty string of at most 32,000 characters.' };
    }
    return { tasks: [params['task']] };
  }
  const tasks = params['tasks'];
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 5) {
    return { error: 'Worker tasks must contain between one and five tasks.' };
  }
  if (tasks.some((task) => typeof task !== 'string' || task.length === 0 || task.length > 32_000)) {
    return { error: 'Every worker task must be a non-empty string of at most 32,000 characters.' };
  }
  return { tasks: tasks as string[] };
}

function workerLaunchParams(task: string, cwd: string): Record<string, unknown> {
  return {
    agent: 'worker',
    task,
    cwd,
    context: 'fresh',
    async: false,
    agentScope: 'user',
    timeoutMs: WORKER_TIMEOUT_MS,
    maxRuntimeMs: WORKER_TIMEOUT_MS,
    toolBudget: { hard: WORKER_TOOL_BUDGET, block: '*' },
    artifacts: true,
    includeProgress: true,
  };
}

function parallelWorkerWorkflow(tasks: readonly string[], worktrees: readonly string[]): string {
  const children = tasks.map((task, index) => ({
    key: `worker-${String(index + 1)}`,
    ...workerLaunchParams(task, worktrees[index] ?? ''),
  }));
  // The script is generated exclusively from JSON, not accepted from the model.
  // pi-subagents runs this in its audited workflow sandbox and runs.all launches
  // the admitted children concurrently.
  return `return runs.all(${JSON.stringify(children)});`;
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
      'Delegate one implementation task, or up to five independent tasks in parallel, to packaged pi-subagents workers. ' +
      'Pass exactly one of task or tasks. Every worker runs in its own mandatory isolated git worktree and returns a patch handoff. ' +
      'Use delegation for substantial code changes after identifying the repository. You remain responsible for reviewing and ' +
      'integrating every patch, resolving overlap, running the final repository gate, and committing. Not available in Plan Mode.',
    parameters: Type.Object(
      {
        repository: Type.String({
          minLength: 1,
          maxLength: 2_048,
          description: 'Absolute path to the existing git repository that should receive isolated worker worktrees.',
        }),
        task: Type.Optional(Type.String({
          minLength: 1,
          maxLength: 32_000,
          description: 'One self-contained implementation task and acceptance criteria for a worker.',
        })),
        tasks: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 32_000 }), {
          minItems: 1,
          maxItems: 5,
          description: 'One to five independent implementation tasks to launch concurrently in separate worktrees.',
        })),
      },
      {
        additionalProperties: false,
        // repository plus exactly one of task/tasks.
        minProperties: 2,
        maxProperties: 2,
      },
    ),
    executionMode: 'sequential',
    execute: async (toolCallId, raw, signal, onUpdate, ctx) => {
      const normalized = normalizedTasks(raw);
      if (normalized.tasks === undefined) {
        return {
          content: [{ type: 'text', text: normalized.error ?? 'Invalid worker tasks.' }],
          details: { code: 'worker_tasks_invalid' },
        };
      }
      const params = raw as { repository?: unknown };
      if (!options.oauthReady()) {
        return {
          content: [{
            type: 'text',
            text: 'Worker delegation currently requires the selected pi OAuth/subscription credential; Pop-stored API keys are intentionally not copied into child processes.',
          }],
          details: { code: 'worker_oauth_required' },
        };
      }
      if (typeof params.repository !== 'string' || !params.repository.startsWith('/')) {
        return {
          content: [{ type: 'text', text: 'The worker repository must be an absolute path.' }],
          details: { code: 'worker_repository_invalid' },
        };
      }

      const source = await resolveWorkerRepository(params.repository);
      const prepared: PreparedWorkerWorktree[] = [];
      let handoffs: WorkerHandoff[] = [];
      let finalized = false;
      try {
        // Resolve HEAD once, then detach every child from that exact commit.
        // Preparation finishes before pi-subagents is invoked, so no two
        // children can ever receive the same mutable worktree.
        for (const index of normalized.tasks.keys()) {
          prepared.push(await createWorkerWorktree(
            source.repository,
            source.baseCommit,
            toolCallId,
            index + 1,
          ));
        }

        const upstreamParams = normalized.tasks.length === 1
          ? workerLaunchParams(normalized.tasks[0] ?? '', prepared[0]?.worktree ?? '')
          : {
              workflowScript: parallelWorkerWorkflow(
                normalized.tasks,
                prepared.map((entry) => entry.worktree),
              ),
              cwd: prepared[0]?.worktree ?? '',
              context: 'fresh',
              async: false,
              agentScope: 'user',
              timeoutMs: WORKER_TIMEOUT_MS,
              maxRuntimeMs: WORKER_TIMEOUT_MS,
              toolBudget: { hard: WORKER_TOOL_BUDGET, block: '*' },
              artifacts: true,
              includeProgress: true,
              mission: false,
            };
        const result = await subagent.execute(
          `delegate-worker-${toolCallId}`,
          upstreamParams,
          signal,
          onUpdate,
          ctx as ExtensionContext,
        );
        for (const usage of workerUsages(result.details)) options.onUsage?.(usage);
        try {
          handoffs = await captureAndRemoveWorkerWorktrees(prepared);
        } finally {
          finalized = true;
        }
        const handoffMessages = handoffs.map((handoff) => {
          const label = handoffs.length === 1 ? 'Worker' : `Worker ${String(handoff.childIndex)}`;
          return {
            type: 'text' as const,
            text: handoff.patchBytes === 0
              ? `${label} worktree produced no patch. Handoff manifest: ${handoff.manifestPath}`
              : `${label} patch captured (${String(handoff.patchBytes)} bytes). Review and apply it from ${handoff.patchPath}. Handoff manifest: ${handoff.manifestPath}`,
          };
        });
        return {
          ...result,
          content: [...result.content, ...handoffMessages],
          details: {
            ...(typeof result.details === 'object' && result.details !== null ? result.details : {}),
            workerHandoffs: handoffs,
            // Keep the established single-worker detail for callers that
            // adopted the original facade contract.
            ...(handoffs.length === 1 ? { workerHandoff: handoffs[0] } : {}),
          },
        };
      } finally {
        if (!finalized && prepared.length > 0) {
          // Upstream failure/cancellation and partial preparation still attempt
          // every capture and cleanup, but never replace the authoritative error.
          try {
            await captureAndRemoveWorkerWorktrees(prepared);
          } catch {
            // The original preparation, cancellation or child failure wins.
          } finally {
            finalized = true;
          }
        }
      }
    },
  });
}

function workerUsages(details: unknown): WorkerUsage[] {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return [];
  const row = details as Record<string, unknown>;
  const results = row['results'];
  if (Array.isArray(results)) {
    const childUsages = results.flatMap((result) => {
      if (result === null || typeof result !== 'object' || Array.isArray(result)) return [];
      const usage = usageRow((result as Record<string, unknown>)['usage']);
      return usage === undefined ? [] : [usage];
    });
    // Per-child detail is authoritative only when it is complete. Never add
    // the aggregate to child rows; fall back to the aggregate alone if an
    // older package omits usage from any result.
    if (results.length > 0 && childUsages.length === results.length) return childUsages;
  }
  const aggregate = usageRow(row['totalChildUsage']);
  return aggregate === undefined ? [] : [aggregate];
}

function usageRow(value: unknown): WorkerUsage | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const row = value as Record<string, unknown>;
  const inputTokens = boundedNumber(row['input']);
  const outputTokens = boundedNumber(row['output']);
  const cost = boundedNumber(row['cost']);
  if (inputTokens === undefined || outputTokens === undefined || cost === undefined) return undefined;
  return { inputTokens, outputTokens, cost };
}

function boundedNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}
