import { mkdirSync } from 'node:fs';
import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionAPI,
  ModelRuntime,
  ToolCallEvent,
  ToolCallEventResult,
  ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import type { ModelInfo } from '../../application/ports/agent-bridge.js';
import { DEFAULT_MODEL_ID, OPENROUTER_PROVIDER_ID } from '../../application/providers/openrouter.js';

/**
 * pi as the rest of the server is allowed to see it: open a session, prompt it,
 * abort it, throw it away. The bridge above ({@link PiAgentBridge}) owns the
 * event mapping and the session cache and knows nothing else about the SDK,
 * which is what lets it be tested without a model, a key or a network.
 *
 * Everything the SDK ships is imported dynamically: an install running the fake
 * bridge -- the CI, the smoke, every test -- never pays to load pi.
 */

/** Re-exported so the pi-facing modules read as one vocabulary. */
export const PROVIDER_ID = OPENROUTER_PROVIDER_ID;
export { DEFAULT_MODEL_ID };

/**
 * Popy's own voice, replacing pi's coding-agent persona. Short and neutral on
 * purpose (Phase 3 plan): what Popy is comes from here, how the user wants it
 * to behave comes from the custom instructions appended after it.
 */
const SYSTEM_PROMPT = [
  'You are Popy, a personal assistant running on a server the user owns.',
  'Answer plainly and helpfully, in the language the user writes in.',
  'You have tools to read and write files and to run commands in your',
  'workspace; use them when they genuinely help with the request.',
].join(' ');

export type PiEngineErrorCode = 'provider_not_configured' | 'model_not_available';

/** A failure the user can act on, as opposed to a bug. */
export class PiEngineError extends Error {
  constructor(
    readonly code: PiEngineErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PiEngineError';
  }
}

/**
 * The safety valve the bridge sets around a run (popy.spec §10). pi calls it
 * before a tool runs and after one produces output; it is what turns "a run
 * that read something suspicious" into "a destructive command that has to be
 * confirmed first".
 */
export interface ToolGuard {
  /** A tool produced output; its text feeds the per-turn taint. */
  onToolResult(text: string): void;
  /** Before a tool runs. Resolve `block: true` to stop it. */
  onToolCall(
    tool: string,
    input: Record<string, unknown>,
  ): Promise<{ block: boolean; reason?: string }>;
}

/** One conversation's live pi session. */
export interface PiSession {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  setModel(modelId: string): Promise<void>;
  /** Sets (or clears) the guard pi consults around each tool call. */
  setGuard(guard: ToolGuard | undefined): void;
  dispose(): void;
  /** Path of pi's JSONL file for this session, once it has one. */
  readonly sessionFile: string | undefined;
}

export interface PiOpenOptions {
  modelId: string;
  sessionFile: string | undefined;
  /** The user's custom instructions, appended to the system prompt. */
  instructions: string;
}

export interface PiEngine {
  open(options: PiOpenOptions): Promise<PiSession>;
  models(): Promise<ModelInfo[]>;
}

export interface SdkPiEngineOptions {
  /** Where the agent works: POPY_WORKSPACE (popy.spec §4). */
  workspace: string;
  /** pi's own JSONL sessions, inside POPY_DATA_DIR. */
  sessionsDir: string;
  /**
   * pi's config directory. Pointed inside POPY_DATA_DIR on purpose: a stray
   * ~/.pi/agent on the host must never lend Popy settings, extensions or -- the
   * one that would matter most -- credentials.
   */
  agentDir: string;
  /** Credential file for the model runtime. Popy-owned, same reason. */
  authPath: string;
  /** Cache for downloaded catalogs. Nothing downloads them today; see below. */
  modelsStorePath: string;
  /** Read late, not captured: the key can arrive after boot, from Settings. */
  apiKey: () => string | undefined;
}

/**
 * The real engine.
 *
 * The model runtime is built once and reused. It is deliberately offline
 * (`allowModelNetwork: false`, `modelsPath: null`): pi's built-in OpenRouter
 * catalog already ships the models with their prices, so a boot never waits on
 * a third party and the cost numbers cannot change under us between restarts.
 */
export class SdkPiEngine implements PiEngine {
  private runtime: Promise<ModelRuntime> | undefined;
  private appliedKey = '';

  constructor(private readonly options: SdkPiEngineOptions) {}

  async open(options: PiOpenOptions): Promise<PiSession> {
    const sdk = await import('@earendil-works/pi-coding-agent');
    const runtime = await this.authenticatedRuntime();

    const model = runtime.getModel(PROVIDER_ID, options.modelId);
    if (model === undefined) {
      throw new PiEngineError(
        'model_not_available',
        `${PROVIDER_ID} has no model "${options.modelId}"`,
      );
    }

    mkdirSync(this.options.workspace, { recursive: true });
    mkdirSync(this.options.sessionsDir, { recursive: true });

    // Reopening is how a conversation survives a restart, and how it survives
    // the idle unload below: pi reads its JSONL back and the model sees the
    // same context it had.
    const sessionManager =
      options.sessionFile === undefined || options.sessionFile.length === 0
        ? sdk.SessionManager.create(this.options.workspace, this.options.sessionsDir)
        : sdk.SessionManager.open(
            options.sessionFile,
            this.options.sessionsDir,
            this.options.workspace,
          );

    // The one thing whose output can block a tool: an inline extension that
    // asks the session's current guard before every tool runs, and feeds it
    // every tool result (popy.spec §10). `noExtensions` still keeps pi's own
    // extensions out; this is ours, not the host's.
    const guardSlot: { current: ToolGuard | undefined } = { current: undefined };

    // A server has no use for pi's CLI trimmings -- skills, prompt templates,
    // themes, context files scavenged from the workspace -- and every one of
    // them is a way for host state to leak into the prompt. What the model
    // hears is exactly Popy's prompt plus the user's instructions.
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd: this.options.workspace,
      agentDir: this.options.agentDir,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: SYSTEM_PROMPT,
      extensionFactories: [
        (pi: ExtensionAPI) => {
          const onToolCall = async (event: ToolCallEvent): Promise<ToolCallEventResult> => {
            const guard = guardSlot.current;
            if (guard === undefined) return {};
            const verdict = await guard.onToolCall(event.toolName, event.input);
            if (!verdict.block) return {};
            return verdict.reason === undefined
              ? { block: true }
              : { block: true, reason: verdict.reason };
          };
          const onToolResult = (event: ToolResultEvent): void => {
            const text = event.content
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('');
            guardSlot.current?.onToolResult(text);
          };
          pi.on('tool_call', onToolCall);
          pi.on('tool_result', onToolResult);
        },
      ],
      ...(options.instructions.length === 0
        ? {}
        : { appendSystemPrompt: [options.instructions] }),
    });
    await resourceLoader.reload();

    const { session } = await sdk.createAgentSession({
      cwd: this.options.workspace,
      agentDir: this.options.agentDir,
      modelRuntime: runtime,
      model,
      sessionManager,
      resourceLoader,
    });

    return new SdkPiSession(session, runtime, guardSlot);
  }

  /** Listing does not need a key -- the catalog is built into pi. */
  async models(): Promise<ModelInfo[]> {
    const runtime = await this.modelRuntime();
    return runtime
      .getModels(PROVIDER_ID)
      .map((model) => ({
        id: model.id,
        name: model.name,
        context: model.contextWindow,
        pricing: { input: model.cost.input, output: model.cost.output },
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private async authenticatedRuntime(): Promise<ModelRuntime> {
    const key = this.options.apiKey();
    if (key === undefined || key.length === 0) {
      throw new PiEngineError(
        'provider_not_configured',
        `no API key for ${PROVIDER_ID}: set one in Settings or OPENROUTER_API_KEY`,
      );
    }

    const runtime = await this.modelRuntime();
    // The runtime credential is an in-memory overlay; a key changed in Settings
    // takes effect on the next run without a restart.
    if (key !== this.appliedKey) {
      await runtime.setRuntimeApiKey(PROVIDER_ID, key);
      this.appliedKey = key;
    }
    return runtime;
  }

  private modelRuntime(): Promise<ModelRuntime> {
    this.runtime ??= this.createRuntime();
    return this.runtime;
  }

  private async createRuntime(): Promise<ModelRuntime> {
    const sdk = await import('@earendil-works/pi-coding-agent');
    mkdirSync(this.options.agentDir, { recursive: true });
    return sdk.ModelRuntime.create({
      authPath: this.options.authPath,
      modelsPath: null,
      modelsStorePath: this.options.modelsStorePath,
      allowModelNetwork: false,
    });
  }
}

class SdkPiSession implements PiSession {
  constructor(
    private readonly session: AgentSession,
    private readonly runtime: ModelRuntime,
    private readonly guardSlot: { current: ToolGuard | undefined },
  ) {}

  setGuard(guard: ToolGuard | undefined): void {
    this.guardSlot.current = guard;
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    return this.session.subscribe(listener);
  }

  prompt(text: string): Promise<void> {
    return this.session.prompt(text);
  }

  abort(): Promise<void> {
    return this.session.abort();
  }

  async setModel(modelId: string): Promise<void> {
    const model = this.runtime.getModel(PROVIDER_ID, modelId);
    if (model === undefined) {
      throw new PiEngineError('model_not_available', `${PROVIDER_ID} has no model "${modelId}"`);
    }
    await this.session.setModel(model);
  }

  dispose(): void {
    this.session.dispose();
  }

  get sessionFile(): string | undefined {
    return this.session.sessionFile;
  }
}
