import type { Attachment, ToolStatus } from '../../domain/chat/chat.js';

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
  /**
   * `status` is the HTTP status of the provider's refusal, when the adapter
   * could tell -- it is what lets failover classify by type instead of prose
   * (popy.spec §15, fase 2).
   */
  | { kind: 'error'; code: string; status?: number };

export interface AgentRunRequest {
  chatId: string;
  prompt: string;
  model: string;
  /** Provider half of the pair (popy.spec §15); empty means the default. */
  provider?: string;
  /** Files sent with the message; the adapter decides how the model sees them. */
  attachments: Attachment[];
  onEvent: (event: AgentEvent) => void;
  /**
   * Asks the user to allow a risky action mid-run (popy.spec §10). Resolves
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
}

/**
 * A question the engine's login flow asks the user (popy.spec §15). These are
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

/**
 * The engine's subscription-auth surface (popy.spec §15): whether a provider
 * holds an OAuth credential, the login flow that obtains one, and the logout
 * that drops it. Separate from {@link AgentBridge} because running a chat and
 * signing in to a subscription are different jobs -- the run orchestration
 * never touches this.
 */
export interface ProviderAuthBridge {
  /** Whether the engine holds working auth for the provider (sync snapshot). */
  hasProviderAuth(providerId: string): boolean;
  /** A cheap credential check, in words the user can act on. */
  checkProviderAuth(providerId: string): Promise<{ ok: boolean; message?: string }>;
  /**
   * Runs the provider's OAuth flow; the credential is persisted by the
   * engine's own store and never crosses this boundary.
   */
  providerLogin(providerId: string, interaction: ProviderAuthInteraction): Promise<void>;
  /** Drops the stored credential (disconnect). */
  providerLogout(providerId: string): Promise<void>;
}
