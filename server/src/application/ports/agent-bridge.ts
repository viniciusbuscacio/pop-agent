import type { Attachment, ExecutionMode, ToolStatus } from '../../domain/chat/chat.js';

/**
 * The only door to the agent engine (docs/agent-flow.md). pi lives behind this
 * port; so does the scripted fake that Phase 2 runs against. The use cases
 * cannot tell which, which is the point: Phase 3 swaps the adapter and the
 * orchestration below it does not change.
 */

export type AgentEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; name: string; status: ToolStatus; detail: string }
  /** A steering input has entered pi's transcript and will shape its next turn. */
  | { kind: 'steering-delivered'; steeringId: string }
  /**
   * `status` is the HTTP status of the provider's refusal, when the adapter
   * could tell -- it is what lets failover classify by type instead of prose
   * (pop-agent.spec §15, fase 2).
   */
  | { kind: 'error'; code: string; status?: number };

export interface AgentSteeringInput {
  id: string;
  prompt: string;
  attachments: Attachment[];
}

/** Controls that exist only while one concrete bridge run is alive. */
export interface AgentRunControl {
  /** Queues an input into the current pi loop, before its next model call. */
  steer(input: AgentSteeringInput): Promise<boolean>;
  /** Removes an input that pi has accepted but has not consumed yet. */
  cancelSteering(id: string): boolean;
  /** Clears every accepted input so the durable FIFO can rebuild exact order. */
  clearSteering(): void;
}

export interface AgentRunRequest {
  chatId: string;
  prompt: string;
  model: string;
  /** Provider half of the pair (pop-agent.spec §15); empty means the default. */
  provider?: string;
  /** Files sent with the message; the adapter decides how the model sees them. */
  attachments: Attachment[];
  /** Plan mode removes every tool not explicitly classified as read-only. */
  executionMode?: ExecutionMode;
  /**
   * The terminal that typed this message, when one did (docs/cli.md, Whose
   * local connections). The adapter points the `local_*` tools at it; undefined means the
   * run has the server's tools only, which is every message from the PWA.
   */
  localConnectionId?: string;
  onEvent: (event: AgentEvent) => void;
  /** Called once the adapter can accept steering for this exact live run. */
  onControlReady?: (control: AgentRunControl) => void;
  /**
   * Asks the user to allow a risky action mid-run (pop-agent.spec §10). Resolves
   * true to proceed, false to block. Absent means "no one is watching" -- the
   * adapter must treat that as a denial, never a silent yes.
   */
  confirm?: (request: { action: string; detail: string }) => Promise<boolean>;
  /** Aborted when the user presses Stop; the adapter must give up promptly. */
  signal: AbortSignal;
}

/** What one run cost, in the provider's own numbers -- never an estimate. */
export interface RunUsage {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** US dollars. */
  cost: number;
}

export interface AgentRunResult {
  /** Absent when the engine never reached a model. */
  usage?: RunUsage;
}

/** One model the user can pick. Everything past the id is best-effort. */
export interface ModelInfo {
  id: string;
  name?: string;
  /** Context window, in tokens. */
  context?: number;
  /** US dollars per million tokens. */
  pricing?: { input: number; output: number };
}

export interface AgentBridge {
  /** Resolves when the run is finished, one way or another. */
  run(request: AgentRunRequest): Promise<AgentRunResult>;
  listModels(providerId?: string): Promise<ModelInfo[]>;
  /**
   * Hard-forgets a chat's session (pop-agent.spec §15, fase 2): the run
   * service calls this when it gives up on an attempt, so a bridge that keeps
   * running in the background can never be re-prompted into a shared context.
   */
  discardSession(chatId: string): void;
  /**
   * One completion outside a chat: the connection test, a title, a distilled
   * skill, a cleaned-up transcription. Every provider answers through the
   * engine here, and that uniformity is the point -- a subscription has no API
   * key to hand an HTTP gateway, so the gateway-only path quietly skipped it
   * and every background job silently fell through to the next provider in
   * the chain (Vinicius, 08/08).
   *
   * Usage comes back when the provider reports it: background work bills like
   * chat work, and llm_runs is the book everything lands in (§14).
   */
  complete(request: EngineCompletionRequest): Promise<{ text: string; usage?: RunUsage }>;
}

/** One prompt, one provider, one answer. No chat, no tools, no history. */
export interface EngineCompletionRequest {
  providerId: string;
  modelId: string;
  prompt: string;
  maxTokens?: number;
}

/**
 * A question the engine's login flow asks the user (pop-agent.spec §15). These are
 * the port's own structural types -- the engine's SDK has equivalents, but
 * the application layer must not know that.
 */
export type ProviderAuthPrompt =
  | { type: 'text' | 'secret' | 'manual_code'; message: string; placeholder?: string }
  | {
      type: 'select';
      message: string;
      options: readonly { id: string; label: string; description?: string }[];
    };

/** Something the login flow tells the user. Never token material. */
export type ProviderAuthEvent =
  | { type: 'info'; message: string; links?: readonly { url: string; label?: string }[] }
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
      type: 'device_code';
      userCode: string;
      verificationUri: string;
      intervalSeconds?: number;
      expiresInSeconds?: number;
    }
  | { type: 'progress'; message: string };

/** The two callbacks a login flow drives, plus the abort that stops it. */
export interface ProviderAuthInteraction {
  signal?: AbortSignal;
  prompt(prompt: ProviderAuthPrompt): Promise<string>;
  notify(event: ProviderAuthEvent): void;
}

/** One rolling allowance returned by a subscription provider. */
export interface ProviderUsageWindow {
  usedPercent: number;
  windowSeconds: number;
  resetAt: number;
}

/** Subscription allowance stripped of account identity and OAuth material. */
export interface ProviderSubscriptionUsage {
  plan: string;
  allowed: boolean;
  limitReached: boolean;
  primary: ProviderUsageWindow;
  secondary?: ProviderUsageWindow;
}

/**
 * The engine's subscription-auth surface (pop-agent.spec §15): whether a provider
 * holds an OAuth credential, the login flow that obtains one, and the logout
 * that drops it. Separate from {@link AgentBridge} because running a chat and
 * signing in to a subscription are different jobs -- the run orchestration
 * never touches this.
 */
export interface ProviderAuthBridge {
  /** Whether the engine holds working auth for the provider (sync snapshot). */
  hasProviderAuth(providerId: string): boolean;
  /**
   * Runs the provider's OAuth flow; the credential is persisted by the
   * engine's own store and never crosses this boundary.
   */
  providerLogin(providerId: string, interaction: ProviderAuthInteraction): Promise<void>;
  /** Drops the stored credential (disconnect). */
  providerLogout(providerId: string): Promise<void>;
  /** Reads a provider-published allowance; undefined when it publishes none. */
  providerSubscriptionUsage(providerId: string): Promise<ProviderSubscriptionUsage | undefined>;
}
