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
import { buildFileTools } from '../files/file-tools.js';
import type { FilesService } from '../../application/files/files-service.js';
import { buildNoteTools } from '../notes/note-tools.js';
import { buildTaskTools } from './task-tools.js';
import { buildSkillTools } from '../skills/skill-tools.js';
import type { SkillsRepo } from '../../application/ports/skills-repo.js';
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
 * Pop Agent's own voice, replacing pi's coding-agent persona. Short and neutral on
 * purpose (Phase 3 plan): what Pop Agent is comes from here, how the user wants it
 * to behave comes from the custom instructions appended after it.
 */
const SYSTEM_PROMPT = [
  'You are Pop Agent, a personal assistant running on a server the user owns.',
  'Answer plainly and helpfully, in the language the user writes in.',
  'You have tools to read and write files and to run commands in your',
  'workspace; use them when they genuinely help with the request.',
  // The product's own vocabulary, spelled out because the agent lives inside
  // the product. Written plainly enough for a weak model -- the deliberate
  // test bench: what works on sabiazinho works on anything.
  'Vocabulary: the user\'s "Files" tab (Arquivos) IS the Files/ folder in',
  'your workspace -- same thing, seen from two sides. A file the user asked',
  'you to create or save is not done until it exists under Files/; the rest',
  'of the workspace is your scratch space, invisible to the user. To delete',
  'inside Files/ always use delete_file (it moves to a trash the user can',
  'restore from) -- never rm. files_search finds the user\'s files by name.',
  '"Notes" (notas) are your own vault: notes_list and its siblings.',
  'Pop Agent also runs scheduled tasks for the user; list_scheduled_tasks shows',
  'them, including yours.',
  // Skills left the conversation entirely (pop-agent.spec §8, 1.66). Without this
  // line the model, asked to make one and holding no tool for it, improvises --
  // and improvising here means claiming it saved something it did not.
  'You do not write skills yourself. Pop Agent reads finished conversations in the',
  'background and distils them, and a skill appears on the Skills screen for the',
  'user to accept. So never announce that you are creating, considering or',
  'declining to create a skill -- it is not your decision and saying it out loud',
  'is noise. If the user asks for one, say plainly that it will be picked up',
  'shortly and will wait for them on the Skills screen; do not claim it exists',
  'yet. Questions ABOUT skills are ordinary questions: answer them, with',
  'skills_list if it helps.',
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
 * The safety valve the bridge sets around a run (pop-agent.spec §10). pi calls it
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

/** An image handed to a multimodal model as input (pop-agent.spec §14, RF-014). */
export interface PiImage {
  /** Base64 (no data-URI prefix). */
  data: string;
  mimeType: string;
}

/** One conversation's live pi session. */
export interface PiSession {
  subscribe(listener: (event: AgentSessionEvent) => void): () => void;
  prompt(text: string, images?: PiImage[]): Promise<void>;
  /** Whether the current model accepts image input (pop-agent.spec §14, RF-014). */
  readonly supportsImages: boolean;
  abort(): Promise<void>;
  /** pi's native compaction (pop-agent.spec §7): summarize the old span, keep the tail. */
  compact(): Promise<void>;
  setModel(providerId: string, modelId: string): Promise<void>;
  /** Sets (or clears) the guard pi consults around each tool call. */
  setGuard(guard: ToolGuard | undefined): void;
  dispose(): void;
  /** Path of pi's JSONL file for this session, once it has one. */
  readonly sessionFile: string | undefined;
  /** The JSONL tree's current leaf; null means before the first entry. */
  getLeafId(): string | null;
  /**
   * Moves the leaf back and resyncs in-memory agent messages from the file.
   * pi's {@link SessionManager.branch} alone only moves the pointer -- the
   * agent keeps whatever it already had until something rebuilds context
   * (see navigateTree in agent-session.js, which assigns buildSessionContext).
   */
  rewindToLeaf(leafId: string | null): void;
}

export interface PiOpenOptions {
  /** The pair is the model identity (pop-agent.spec §15). */
  providerId: string;
  modelId: string;
  sessionFile: string | undefined;
  /** The user's custom instructions, appended to the system prompt. */
  instructions: string;
  /** The conversation this session serves, for per-chat tools (tasks, MCP). */
  chatId: string;
  /**
   * The terminal that typed the message this run answers, if it was one
   * (docs/cli.md, Whose hands). Undefined for the PWA, and the run then has
   * the server's tools only. Fixed when the message was accepted: attaching
   * or detaching a terminal afterwards does not reach into a run in flight.
   */
  handsConnectionId?: string;
}

export interface PiEngine {
  open(options: PiOpenOptions): Promise<PiSession>;
  models(providerId: string): Promise<ModelInfo[]>;
  /** One completion outside a chat, for every kind of provider alike. */
  complete(request: {
    providerId: string;
    modelId: string;
    prompt: string;
    maxTokens?: number;
  }): Promise<string>;
  /** Whether the runtime holds working auth for the provider (sync snapshot). */
  hasProviderAuth(providerId: string): boolean;
  /** Runs pi's OAuth login; the credential lands in the runtime's own store. */
  providerLogin(providerId: string, interaction: ProviderAuthInteraction): Promise<void>;
  /** Drops the stored credential (disconnect). */
  providerLogout(providerId: string): Promise<void>;
}

export interface SdkPiEngineOptions {
  /** Where the agent works: POP_AGENT_WORKSPACE (pop-agent.spec §4). */
  workspace: string;
  /** pi's own JSONL sessions, inside POP_AGENT_DATA_DIR. */
  sessionsDir: string;
  /**
   * pi's config directory. Pointed inside POP_AGENT_DATA_DIR on purpose: a stray
   * ~/.pi/agent on the host must never lend Pop Agent settings, extensions or -- the
   * one that would matter most -- credentials.
   */
  agentDir: string;
  /** Credential file for the model runtime. Pop Agent-owned, same reason. */
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
   * The user-created custom instances (pop-agent.spec §15): pi has no builtin for
   * them, so the engine registers each as an OpenAI-compatible provider,
   * lazily on first use and again whenever its data changed -- adding or
   * editing one never needs a restart. Read late, not captured.
   */
  customProviders?: () => {
    id: string;
    name: string;
    baseURL: string;
    defaultModel: string;
    /** Every model this endpoint serves; absent falls back to defaultModel. */
    models?: { id: string; context?: number }[];
  }[];
  /** The agent's notes vault; its tools are registered on every session. */
  notesVault?: NotesVault;
  /** Cross-conversation memory; its tools and the recent-chats catalog. */
  memory?: MemoryRepo;
  /** The scheduled tasks Pop Agent runs, so the agent can SEE them (task-tools). */
  scheduledTasks?: () => import('../../domain/tasks/task.js').Task[];
  /**
   * Real numbers for the continuity note (pop-agent.spec §7): how many messages
   * the chat has stored, so a resumed session knows the size of what it
   * only partially sees.
   */
  chatStats?: (chatId: string) => { messages: number } | undefined;
  /** Hybrid (FTS5 + embeddings) search behind memory_search. */
  memorySearch?: MemorySearcher;
  /** The living document the agent keeps about the user; tools + prompt. */
  userMemory?: UserMemoryRepo;
  /** The user's Files folder: powers delete_file and files_search (pop-agent.spec §14). */
  files?: FilesService;
  /**
   * The skills vault, so the agent can read its own skills and write a new
   * one when the user asks (pop-agent.spec §8, auto-skill fase b).
   */
  skills?: SkillsRepo;
  /**
   * Whether a skill the agent distils goes live immediately (pop-agent.spec §8).
   * A thunk, so Settings takes effect on the next skill written rather than
   * on the next restart.
   */
  autoApproveSkills?: () => boolean;
  /** MCP tools are built per session so enabled servers and capabilities stay current. */
  mcpTools?: (defineTool: typeof import('@earendil-works/pi-coding-agent').defineTool, chatId: string) => ToolDefinition[];
  /**
   * The second pair of hands (docs/cli.md, Whose hands): pi's own tools built
   * again with remote operations, pointed at the terminal that sent this
   * run's message. Given the whole sdk rather than `defineTool`, because
   * these are pi's tool definitions re-pointed, not new tools.
   */
  localTools?: (
    sdk: typeof import('@earendil-works/pi-coding-agent'),
    handsConnectionId: string | undefined,
  ) => ToolDefinition[];
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
  /** Per custom id, the registration last applied, to re-register on change. */
  private readonly customRegistered = new Map<string, string>();

  constructor(private readonly options: SdkPiEngineOptions) {
    // Warm the runtime so the sync hasProviderAuth answers truthfully from
    // the first settings-page load. Only the real engine is ever constructed
    // (main.ts builds it for POP_AGENT_ENGINE=pi alone), so a fake install still
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
    // every tool result (pop-agent.spec §10). `noExtensions` still keeps pi's own
    // extensions out; this is ours, not the host's.
    const guardSlot: { current: ToolGuard | undefined } = { current: undefined };

    // A server has no use for pi's CLI trimmings -- skills, prompt templates,
    // themes, context files scavenged from the workspace -- and every one of
    // them is a way for host state to leak into the prompt. What the model
    // hears is exactly Pop Agent's prompt plus the user's instructions.
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
      // recent conversations (pop-agent.spec §7.1) -- names only, as untrusted
      // data, so the agent knows what memory it can open without being told.
      appendSystemPrompt: [
        ...(options.instructions.length === 0 ? [] : [options.instructions]),
        ...this.userMemoryBlock(),
        ...(this.recentChatsCatalog() ?? []),
        ...this.continuityNote(options),
      ],
    });
    await resourceLoader.reload();

    // Pop Agent's own tools, built with this session's SDK so pi stays one dynamic
    // import. The built-in read/bash/edit/write stay on; these are added.
    const customTools: ToolDefinition[] = [
      ...(this.options.notesVault === undefined
        ? []
        : buildNoteTools(sdk.defineTool, this.options.notesVault)),
      ...(this.options.scheduledTasks === undefined
        ? []
        : buildTaskTools(sdk.defineTool, this.options.scheduledTasks, () => Date.now())),
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
      ...(this.options.files === undefined ? [] : buildFileTools(sdk.defineTool, this.options.files)),
      ...(this.options.skills === undefined
        ? []
        : buildSkillTools(sdk.defineTool, this.options.skills)),
      ...buildWebTools(sdk.defineTool),
      ...(this.options.mcpTools?.(sdk.defineTool, options.chatId) ?? []),
      ...(this.options.localTools?.(sdk, options.handsConnectionId) ?? []),
    ];

    // The compaction policy, explicit instead of inherited defaults
    // (pop-agent.spec §7): pi summarizes the old span when the context passes
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
   * system prompt (pop-agent.spec §7.1): titles and summaries only, so the agent
   * can offer "shall I open our chat about X?" and reach it with memory_open.
   */
  /**
   * A resumed session sees only a slice of the conversation (pop-agent.spec §7):
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
   * The living document about the user, for the system prompt (pop-agent.spec §7).
   * This is Pop Agent's own trusted memory, not external content, so it is not
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
    // A configured custom instance lists its registered model; one still
    // being filled in simply has no catalog yet.
    this.registerCustomIfAny(runtime, providerId);
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

  /**
   * One completion, outside any chat (pop-agent.spec §15). `authenticatedRuntime`
   * is the whole reason this lives here: it already resolves an API key and a
   * subscription credential through the same door, so a caller never has to
   * know which kind of provider it is holding.
   */
  async complete(request: {
    providerId: string;
    modelId: string;
    prompt: string;
    maxTokens?: number;
  }): Promise<string> {
    const runtime = await this.authenticatedRuntime(request.providerId);
    const model = runtime.getModel(request.providerId, request.modelId);
    if (model === undefined) {
      throw new PiEngineError(
        'provider_not_configured',
        `${request.providerId} has no model "${request.modelId}"`,
      );
    }
    const answer = await runtime.completeSimple(
      model,
      { messages: [{ role: 'user', content: request.prompt, timestamp: Date.now() }] },
      request.maxTokens === undefined ? undefined : { maxTokens: request.maxTokens },
    );
    if (answer.stopReason === 'error' || answer.stopReason === 'aborted') {
      throw new Error(answer.errorMessage ?? 'the provider refused the request');
    }
    // A budget spent on thinking leaves no words, and that is still a round
    // trip that worked -- the connection test asks nothing more than that.
    return answer.content
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
      .map((part) => part.text)
      .join('');
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

  /**
   * pi's interactive OAuth login (pop-agent.spec §15, fase 1.5). The credential is
   * persisted by the runtime into Pop Agent's own auth file (`authPath`); nothing
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
    // A custom instance registers (or re-registers) lazily on use, so an
    // instance added or edited in Settings works without a restart. Throws
    // provider_not_configured when the instance has no URL or model yet.
    this.registerCustomIfAny(runtime, providerId, { requireConfigured: true });
    const key = this.options.apiKey(providerId);
    if (key !== undefined && key.length > 0) {
      // The runtime credential is an in-memory overlay; a key changed in
      // Settings takes effect on the next run without a restart.
      if (key !== this.appliedKeys.get(providerId)) {
        // allowNetwork: false, exactly as pi's own CLI calls it. Without it
        // the refresh this triggers inherits modelNetworkEnabled -- which is
        // TRUE unless PI_OFFLINE is set, whatever allowModelNetwork said at
        // create() -- and goes to the network for provider catalogs with no
        // timeout. The first key applied per process then hangs for as long
        // as the slowest catalog endpoint feels like: measured live at 60s+,
        // which ate the run watchdog and failed over through every provider
        // (Vinicius, 05/08). The catalog is refreshed at create(), under a
        // 15s cap; applying a key needs no fresher one.
        await runtime.setRuntimeApiKey(providerId, key, { allowNetwork: false });
        this.appliedKeys.set(providerId, key);
      }
      return runtime;
    }

    // No Pop Agent-stored key. An OAuth provider whose subscription credential
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
   * A custom instance exists only as data the user typed (pop-agent.spec §15):
   * when the id names one, register it with pi as an OpenAI-compatible
   * endpoint carrying its one configured model. Stamped per id, so an edit
   * re-registers and an untouched instance costs a string compare. Not a
   * custom id at all: does nothing.
   */
  private registerCustomIfAny(
    runtime: ModelRuntime,
    providerId: string,
    options?: { requireConfigured?: boolean },
  ): void {
    const instance = this.options
      .customProviders?.()
      .find((candidate) => candidate.id === providerId);
    if (instance === undefined) return;
    if (instance.baseURL.length === 0 || instance.defaultModel.length === 0) {
      if (options?.requireConfigured !== true) return;
      throw new PiEngineError(
        'provider_not_configured',
        `the custom provider "${instance.name}" needs a URL and a model: set them in Settings`,
      );
    }
    // Every model the endpoint serves, not just the configured one: pi
    // refuses any id it was not registered with, so a model the picker
    // offered would fail at open() -- which surfaced as a hung run, since
    // the session is opened before anything streams (Vinicius, 05/08).
    const models =
      instance.models !== undefined && instance.models.length > 0
        ? instance.models
        : [{ id: instance.defaultModel }];
    // The catalog is in the stamp: an endpoint that learns new models has to
    // be registered again, or the picker offers what pi still refuses.
    const stamp = `${instance.name} ${instance.baseURL} ${models.map((m) => m.id).join(',')}`;
    if (stamp === this.customRegistered.get(providerId)) return;
    runtime.registerProvider(providerId, {
      name: instance.name,
      baseUrl: instance.baseURL,
      api: 'openai-completions',
      models: models.map((model) => ({
        id: model.id,
        name: model.id,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: model.context ?? 128_000,
        maxTokens: 16_384,
        // The most conservative payload, on purpose. pi auto-detects
        // compatibility from the URL, and a custom endpoint is by definition
        // one it has never heard of, so detection lands on "standard OpenAI"
        // and sends fields like `store: false`. A strict server rejects what
        // it does not know -- Maritaca answers 422 "extra fields not
        // permitted" to `store` -- while a lenient one never misses what was
        // not sent. Plain `max_tokens` and the `system` role are the two
        // spellings every compatible endpoint understands (Vinicius, 05/08).
        compat: {
          supportsStore: false,
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: 'max_tokens',
        },
      })),
    });
    this.customRegistered.set(providerId, stamp);
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

  getLeafId(): string | null {
    return this.session.sessionManager.getLeafId();
  }

  rewindToLeaf(leafId: string | null): void {
    if (leafId === null) this.session.sessionManager.resetLeaf();
    else this.session.sessionManager.branch(leafId);
    const sessionContext = this.session.sessionManager.buildSessionContext();
    this.session.agent.state.messages = sessionContext.messages;
  }
}
