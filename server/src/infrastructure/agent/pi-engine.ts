import { mkdirSync } from 'node:fs';
import type {
  AgentSession,
  AgentSessionEvent,
  ExtensionAPI,
  ModelRuntime,
  ToolCallEvent,
  ToolCallEventResult,
  ToolDefinition,
  ToolResultEvent,
} from '@earendil-works/pi-coding-agent';
import type {
  ModelInfo,
  ProviderAuthInteraction,
} from '../../application/ports/agent-bridge.js';
import { DEFAULT_MODEL_ID, OPENROUTER_PROVIDER_ID } from '../../application/providers/openrouter.js';
import { providerDefinition } from '../../application/providers/provider-definitions.js';
import type { MemoryRepo } from '../../application/ports/memory-repo.js';
import type { UserMemoryRepo } from '../../application/ports/user-memory-repo.js';
import { envelope } from '../../domain/safety/sanitize.js';
import { buildMemoryTools, type MemorySearcher } from '../memory/memory-tools.js';
import { buildUserMemoryTools } from '../memory/user-memory-tools.js';
import { buildArtifactTools, type FileSearch } from '../artifacts/artifact-tools.js';
import type { ArtifactExtractor } from '../artifacts/artifact-extractor.js';
import type { ArtifactService } from '../../application/artifacts/artifact-service.js';
import { buildNoteTools } from '../notes/note-tools.js';
import type { NotesVault } from '../notes/notes-vault.js';
import { buildWebTools } from '../web/web-tools.js';

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

/** An image handed to a multimodal model as input (popy.spec §14, RF-014). */
export interface PiImage {
  /** Base64 (no data-URI prefix). */
  data: string;
  mimeType: string;
}

/** One conversation's live pi session. */
export interface PiSession {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, images?: PiImage[]): Promise<void>;
  /** Whether the current model accepts image input (popy.spec §14, RF-014). */
  readonly supportsImages: boolean;
  abort(): Promise<void>;
  /** pi's native compaction (popy.spec §7): summarize the old span, keep the tail. */
  compact(): Promise<void>;
  setModel(providerId: string, modelId: string): Promise<void>;
  /** Sets (or clears) the guard pi consults around each tool call. */
  setGuard(guard: ToolGuard | undefined): void;
  dispose(): void;
  /** Path of pi's JSONL file for this session, once it has one. */
  readonly sessionFile: string | undefined;
}

export interface PiOpenOptions {
  /** The pair is the model identity (popy.spec §15). */
  providerId: string;
  modelId: string;
  sessionFile: string | undefined;
  /** The user's custom instructions, appended to the system prompt. */
  instructions: string;
  /** The conversation this session serves, so save_artifact can attribute. */
  chatId: string;
}

export interface PiEngine {
  open(options: PiOpenOptions): Promise<PiSession>;
  models(providerId: string): Promise<ModelInfo[]>;
  /** Whether the runtime holds working auth for the provider (sync snapshot). */
  hasProviderAuth(providerId: string): boolean;
  /** pi's cheap credential check, in ok/message terms. */
  checkProviderAuth(providerId: string): Promise<{ ok: boolean; message?: string }>;
  /** Runs pi's OAuth login; the credential lands in the runtime's own store. */
  providerLogin(providerId: string, interaction: ProviderAuthInteraction): Promise<void>;
  /** Drops the stored credential (disconnect). */
  providerLogout(providerId: string): Promise<void>;
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
  /**
   * Optional operator overrides for the built-in catalog (pi models.json).
   * Absent file means no overrides. Exists so a per-model ceiling such as
   * maxTokens can be lowered when the provider key runs on a tight credit
   * limit -- OpenRouter rejects a request whose max_tokens exceeds what the
   * remaining balance can afford, which otherwise bricks every turn.
   */
  modelsPath?: string;
  /** Read late, not captured: keys can arrive after boot, from Settings. */
  apiKey: (providerId: string) => string | undefined;
  /**
   * The custom provider's endpoint and model, when configured (popy.spec
   * §15). pi has no builtin for it, so the engine registers it as an
   * OpenAI-compatible provider on first use.
   */
  customProvider?: () => { baseURL: string; defaultModel: string } | undefined;
  /** The agent's notes vault; its tools are registered on every session. */
  notesVault?: NotesVault;
  /** Cross-conversation memory; its tools and the recent-chats catalog. */
  memory?: MemoryRepo;
  /**
   * Real numbers for the continuity note (popy.spec §7): how many messages
   * the chat has stored, so a resumed session knows the size of what it
   * only partially sees.
   */
  chatStats?: (chatId: string) => { messages: number } | undefined;
  /** Hybrid (FTS5 + embeddings) search behind memory_search. */
  memorySearch?: MemorySearcher;
  /** The living document the agent keeps about the user; tools + prompt. */
  userMemory?: UserMemoryRepo;
  /** Artifacts: powers the save_artifact tool (popy.spec §14). */
  artifacts?: ArtifactService;
  /** Extracts text from PDF/DOCX/images for read_artifact (popy.spec §14). */
  artifactExtractor?: ArtifactExtractor;
  /** Semantic search over Files, when the embedder exists. */
  fileSearch?: FileSearch;
}

/**
 * The real engine.
 *
 * The model runtime is built once and reused. It is deliberately offline
 * (`allowModelNetwork: false`): pi's built-in OpenRouter catalog already ships
 * the models with their prices, so a boot never waits on a third party and the
 * cost numbers cannot change under us between restarts. The only local input
 * is the optional operator overrides file (`modelsPath`), described above.
 */
export class SdkPiEngine implements PiEngine {
  private runtime: Promise<ModelRuntime> | undefined;
  /** The resolved runtime, for the sync auth question below. */
  private runtimeNow: ModelRuntime | undefined;
  private readonly appliedKeys = new Map<string, string>();
  /** The custom provider registration last applied, to re-register on change. */
  private customRegistered = '';

  constructor(private readonly options: SdkPiEngineOptions) {
    // Warm the runtime so the sync hasProviderAuth answers truthfully from
    // the first settings-page load. Only the real engine is ever constructed
    // (main.ts builds it for POPY_AGENT=pi alone), so a fake install still
    // never pays to load pi.
    void this.modelRuntime().catch(() => undefined);
  }

  async open(options: PiOpenOptions): Promise<PiSession> {
    const sdk = await import('@earendil-works/pi-coding-agent');
    const runtime = await this.authenticatedRuntime(options.providerId);

    const model = runtime.getModel(options.providerId, options.modelId);
    if (model === undefined) {
      throw new PiEngineError(
        'model_not_available',
        `${options.providerId} has no model "${options.modelId}"`,
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
      // The system prompt gains the user's instructions and a catalog of
      // recent conversations (popy.spec §7.1) -- names only, as untrusted
      // data, so the agent knows what memory it can open without being told.
      appendSystemPrompt: [
        ...(options.instructions.length === 0 ? [] : [options.instructions]),
        ...this.userMemoryBlock(),
        ...(this.recentChatsCatalog() ?? []),
        ...this.continuityNote(options),
      ],
    });
    await resourceLoader.reload();

    // Popy's own tools, built with this session's SDK so pi stays one dynamic
    // import. The built-in read/bash/edit/write stay on; these are added.
    const customTools: ToolDefinition[] = [
      ...(this.options.notesVault === undefined
        ? []
        : buildNoteTools(sdk.defineTool, this.options.notesVault)),
      ...(this.options.memory === undefined
        ? []
        : buildMemoryTools(
            sdk.defineTool,
            this.options.memory,
            this.options.memorySearch ?? { search: (query) => Promise.resolve(this.options.memory!.search(query)) },
          )),
      ...(this.options.userMemory === undefined
        ? []
        : buildUserMemoryTools(sdk.defineTool, this.options.userMemory)),
      ...(this.options.artifacts === undefined
        ? []
        : buildArtifactTools(
            sdk.defineTool,
            this.options.artifacts,
            this.options.workspace,
            options.chatId,
            this.options.artifactExtractor,
            this.options.fileSearch,
          )),
      ...buildWebTools(sdk.defineTool),
    ];

    // The compaction policy, explicit instead of inherited defaults
    // (popy.spec §7): pi summarizes the old span when the context passes
    // `window - reserveTokens`, keeping a 20k-token tail. inMemory also
    // keeps a host ~/.pi settings file from leaking in.
    const settingsManager = sdk.SettingsManager.inMemory({
      compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    });

    const { session } = await sdk.createAgentSession({
      cwd: this.options.workspace,
      agentDir: this.options.agentDir,
      modelRuntime: runtime,
      model,
      sessionManager,
      settingsManager,
      resourceLoader,
      ...(customTools.length === 0 ? {} : { customTools }),
    });

    return new SdkPiSession(session, runtime, guardSlot, model.input.includes('image'));
  }

  /**
   * The last handful of conversations, as an untrusted-data block for the
   * system prompt (popy.spec §7.1): titles and summaries only, so the agent
   * can offer "shall I open our chat about X?" and reach it with memory_open.
   */
  /**
   * A resumed session sees only a slice of the conversation (popy.spec §7):
   * the continuity note says the real numbers and kills the classic
   * post-restart hallucination -- answering from memory what a tool result
   * used to say. Untrusted-data envelope, never bare system authority.
   */
  private continuityNote(options: PiOpenOptions): string[] {
    if (options.sessionFile === undefined || options.sessionFile.length === 0) return [];
    const stats = this.options.chatStats?.(options.chatId);
    if (stats === undefined || stats.messages === 0) return [];
    return [
      envelope(
        [
          'This conversation continues after a server restart or an idle unload.',
          `The restored context holds the most recent slice of the ${String(stats.messages)} stored messages; older turns were compacted or trimmed.`,
          'Page back with memory_open or memory_search, and never claim you have no memory before searching.',
          'Tool results from before the restart may not have survived: re-run the tool instead of answering from memory.',
        ].join(' '),
        'session:continuity',
      ),
    ];
  }

  private recentChatsCatalog(): string[] | undefined {
    const memory = this.options.memory;
    if (memory === undefined) return undefined;
    const recent = memory.recentChats(15);
    if (recent.length === 0) return undefined;

    const lines = recent
      .map((chat) => {
        const summary = chat.summary.length > 0 ? ` — ${chat.summary}` : '';
        return `- ${chat.title} (chatId: ${chat.chatId})${summary}`;
      })
      .join('\n');
    return [
      envelope(
        `Recent conversations you can open with memory_open:\n${lines}`,
        'memory:recent-catalog',
      ),
    ];
  }

  /**
   * The living document about the user, for the system prompt (popy.spec §7).
   * This is Popy's own trusted memory, not external content, so it is not
   * enveloped -- but it is capped, and secrets were scrubbed on write.
   */
  private userMemoryBlock(): string[] {
    const doc = this.options.userMemory?.read().doc ?? '';
    if (doc.length === 0) return [];
    return [`## What you know about the user\n${doc.slice(0, 8_000)}`];
  }

  /** Listing does not need a key -- the catalog is built into pi. */
  async models(providerId: string): Promise<ModelInfo[]> {
    const runtime = await this.modelRuntime();
    return runtime
      .getModels(providerId)
      .map((model) => ({
        id: model.id,
        name: model.name,
        context: model.contextWindow,
        pricing: { input: model.cost.input, output: model.cost.output },
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /** Whether the runtime already holds auth for a provider (OAuth included). */
  hasProviderAuth(providerId: string): boolean {
    // The question is sync (status endpoints are), the runtime build is not:
    // warm it and answer "not yet" until it exists. The constructor already
    // starts the build, so this only matters in the first instants of a boot.
    if (this.runtimeNow === undefined) {
      void this.modelRuntime().catch(() => undefined);
      return false;
    }
    return this.runtimeNow.hasConfiguredAuth(providerId);
  }

  /** pi's own credential check, translated to words a card can show. */
  async checkProviderAuth(providerId: string): Promise<{ ok: boolean; message?: string }> {
    const runtime = await this.modelRuntime();
    const check = await runtime.checkAuth(providerId);
    if (check === undefined) {
      return { ok: false, message: 'Not signed in.' };
    }
    return { ok: true, ...(check.source === undefined ? {} : { message: check.source }) };
  }

  /**
   * pi's interactive OAuth login (popy.spec §15, fase 1.5). The credential is
   * persisted by the runtime into Popy's own auth file (`authPath`); nothing
   * comes back to the caller.
   */
  async providerLogin(providerId: string, interaction: ProviderAuthInteraction): Promise<void> {
    const runtime = await this.modelRuntime();
    await runtime.login(providerId, 'oauth', interaction);
  }

  async providerLogout(providerId: string): Promise<void> {
    const runtime = await this.modelRuntime();
    await runtime.logout(providerId);
  }

  private async authenticatedRuntime(providerId: string): Promise<ModelRuntime> {
    const runtime = await this.modelRuntime();
    const key = this.options.apiKey(providerId);
    if (key !== undefined && key.length > 0) {
      if (providerId === 'custom') this.registerCustom(runtime);
      // The runtime credential is an in-memory overlay; a key changed in
      // Settings takes effect on the next run without a restart.
      if (key !== this.appliedKeys.get(providerId)) {
        await runtime.setRuntimeApiKey(providerId, key);
        this.appliedKeys.set(providerId, key);
      }
      return runtime;
    }

    // No Popy-stored key. An OAuth provider whose subscription credential
    // sits in the runtime's store is configured all the same -- a login flow
    // put it there, and pi resolves it per request. Only declared-oauth
    // providers take this door: an api-key provider must never quietly ride
    // ambient host credentials.
    if (
      providerDefinition(providerId)?.authType === 'oauth' &&
      runtime.hasConfiguredAuth(providerId)
    ) {
      return runtime;
    }

    // Points at Settings, never at internals: the user fixes this there.
    throw new PiEngineError(
      'provider_not_configured',
      `no API key for ${providerId}: set one in Settings`,
    );
  }

  /**
   * The custom provider exists only as data the user typed (popy.spec §15):
   * register it with pi as an OpenAI-compatible endpoint carrying its one
   * configured model. Re-registered when the URL or model changes.
   */
  private registerCustom(runtime: ModelRuntime): void {
    const config = this.options.customProvider?.();
    if (config === undefined || config.baseURL.length === 0 || config.defaultModel.length === 0) {
      throw new PiEngineError(
        'provider_not_configured',
        'the custom provider needs a URL and a model: set them in Settings',
      );
    }
    const stamp = `${config.baseURL} ${config.defaultModel}`;
    if (stamp === this.customRegistered) return;
    runtime.registerProvider('custom', {
      name: 'Custom (OpenAI-compatible)',
      baseUrl: config.baseURL,
      api: 'openai-completions',
      models: [
        {
          id: config.defaultModel,
          name: config.defaultModel,
          reasoning: false,
          input: ['text'],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128_000,
          maxTokens: 16_384,
        },
      ],
    });
    this.customRegistered = stamp;
  }

  private modelRuntime(): Promise<ModelRuntime> {
    this.runtime ??= this.createRuntime().then((runtime) => {
      this.runtimeNow = runtime;
      return runtime;
    });
    return this.runtime;
  }

  private async createRuntime(): Promise<ModelRuntime> {
    const sdk = await import('@earendil-works/pi-coding-agent');
    mkdirSync(this.options.agentDir, { recursive: true });
    return sdk.ModelRuntime.create({
      authPath: this.options.authPath,
      modelsPath: this.options.modelsPath ?? null,
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
    public supportsImages: boolean = false,
  ) {}

  setGuard(guard: ToolGuard | undefined): void {
    this.guardSlot.current = guard;
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    return this.session.subscribe(listener);
  }

  prompt(text: string, images?: PiImage[]): Promise<void> {
    if (images === undefined || images.length === 0) return this.session.prompt(text);
    // Only reached when the model accepts image input (the bridge checks
    // supportsImages first): send the images inline as multimodal content.
    return this.session.prompt(text, {
      images: images.map((image) => ({
        type: 'image' as const,
        data: image.data,
        mimeType: image.mimeType,
      })),
    });
  }

  abort(): Promise<void> {
    return this.session.abort();
  }

  async compact(): Promise<void> {
    await this.session.compact();
  }

  async setModel(providerId: string, modelId: string): Promise<void> {
    const model = this.runtime.getModel(providerId, modelId);
    if (model === undefined) {
      throw new PiEngineError('model_not_available', `${providerId} has no model "${modelId}"`);
    }
    this.supportsImages = model.input.includes('image');
    await this.session.setModel(model);
  }

  dispose(): void {
    this.session.dispose();
  }

  get sessionFile(): string | undefined {
    return this.session.sessionFile;
  }
}
