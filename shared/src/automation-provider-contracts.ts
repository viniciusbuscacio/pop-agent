/**
 * A background task as the Tasks screen shows it (docs/specs/Spec-Pop-General.md §21). Times are
 * ISO strings on the wire, like every other timestamp the API hands out, even
 * though the table stores epoch milliseconds.
 */
export type TaskScheduleKindDTO = 'once' | 'interval';

export interface TaskDTO {
  id: string;
  title: string;
  prompt: string;
  scheduleKind: TaskScheduleKindDTO;
  /** Present only for `interval`. */
  intervalMinutes?: number;
  /** When it next runs; absent when nothing is scheduled. */
  nextRunAt?: string;
  enabled: boolean;
  /** Push a notification when a run finishes. Default on. */
  notifyOnFinish: boolean;
  /** Archive the conversation a run wrote into, as soon as it ends. Default off. */
  archiveChat: boolean;
  /** Scheduled ticks call the LLM only after a real user message. Default off. */
  runOnlyWithNewMessages: boolean;
  createdAt: string;
  lastRunAt?: string;
  /** `ok`, or the code the last run failed with. */
  lastStatus?: string;
  /** The conversation the last run wrote into, so the status can link to it. */
  lastChatId?: string;
}

/** `GET /v1/tasks` */
export interface TasksResponse {
  tasks: TaskDTO[];
}

/** `POST /v1/tasks` */
export interface CreateTaskRequest {
  title: string;
  prompt: string;
  scheduleKind: TaskScheduleKindDTO;
  intervalMinutes?: number;
  notifyOnFinish?: boolean;
  archiveChat?: boolean;
  runOnlyWithNewMessages?: boolean;
}

/** `PATCH /v1/tasks/:id` — every field optional, the rest is left alone. */
export interface UpdateTaskRequest {
  title?: string;
  prompt?: string;
  scheduleKind?: TaskScheduleKindDTO;
  intervalMinutes?: number;
  notifyOnFinish?: boolean;
  archiveChat?: boolean;
  runOnlyWithNewMessages?: boolean;
}

/** `POST /v1/tasks/:id/toggle` — the enabled switch. */
export interface ToggleTaskRequest {
  enabled: boolean;
}

/** `POST /v1/tasks/:id/run-now` — queued, not run inline; 202. */
export interface RunTaskNowResponse {
  started: boolean;
}

/** One row of the model catalog. Everything past the id is best-effort. */
export interface ModelDTO {
  id: string;
  name?: string;
  /** Context window, in tokens. */
  context?: number;
  /** US dollars per million tokens. */
  pricing?: { input: number; output: number };
}

/** Where the catalog came from, freshest first (the source label). */
export type ModelCatalogSource = 'live' | 'cache' | 'engine' | 'static';

export interface ModelsResponse {
  models: ModelDTO[];
  source: ModelCatalogSource;
}

export interface RecentModelDTO {
  provider: string;
  model: string;
  usedAt: string;
}

export interface RecentModelsResponse {
  models: RecentModelDTO[];
}

/**
 * `GET /v1/providers` — whether each provider can be used, never the key
 * itself. `source` says where the key came from, because a key set by the
 * environment cannot be cleared from the UI.
 */
export interface ProviderStatusDTO {
  id: string;
  name: string;
  /** How the provider authenticates: a stored API key, or pi's OAuth login. */
  authType: 'api-key' | 'oauth';
  configured: boolean;
  source: 'settings' | 'env' | 'oauth' | null;
  defaultModel: string;
  /** The model this provider uses for Pop Agent's own background work (§15). */
  serviceModel: string;
  allowCustomModel: boolean;
  /** A custom instance's endpoint; never a secret (docs/specs/Spec-Pop-General.md §15). */
  baseURL?: string;
  /** True for a user-created custom instance: editable, deletable. */
  custom?: boolean;
  /** Position in the priority list, 1-based. #1 is the global default. */
  order: number;
  /** The user's on/off switch: a disabled provider never serves a run. */
  enabled: boolean;
  /** When set, the last run failed with an auth-class error (docs/specs/Spec-Pop-General.md §15). */
  authErrorAt?: string;
}

export interface ProvidersResponse {
  providers: ProviderStatusDTO[];
}

/**
 * `GET /v1/providers/:id/credits` — the provider's balance, when it publishes
 * one (OpenRouter does). Any failure is a non-200: the client hides the row.
 */
export interface ProviderCreditsResponse {
  remaining: number;
  used: number;
}

/** One rolling subscription allowance reported by the provider. */
export interface ProviderUsageWindowDTO {
  usedPercent: number;
  windowSeconds: number;
  /** Unix time in seconds, exactly as the provider reports it. */
  resetAt: number;
}

/**
 * `GET /v1/providers/:id/subscription-usage` — plan allowance, never account
 * identity or OAuth material. Currently published by the OpenAI subscription.
 */
export interface ProviderSubscriptionUsageResponse {
  plan: string;
  allowed: boolean;
  limitReached: boolean;
  primary: ProviderUsageWindowDTO;
  secondary?: ProviderUsageWindowDTO;
}

/** `PUT /v1/providers/:id/key` — write-only: no route ever returns the key. */
export interface SetProviderKeyRequest {
  apiKey: string;
}

/**
 * Unlimited custom OpenAI-compatible providers (docs/specs/Spec-Pop-General.md §15). An instance
 * is created empty first -- its id anchors the key and the card -- then
 * edited in place. The key travels only through the ordinary key route.
 */
export interface CreateCustomProviderRequest {
  name?: string;
}

export interface CreateCustomProviderResponse {
  /** `custom-` + 10 hex characters. */
  id: string;
  providers: ProviderStatusDTO[];
}

/** One validated save for every field on an existing provider card. */
export interface ProviderConfigurationRequest {
  defaultModel: string;
  serviceModel: string;
  priority: number;
  /** Omitted keeps the write-only credential already stored. */
  apiKey?: string;
  /** Custom-provider identity fields; rejected for built-ins. */
  name?: string;
  baseURL?: string;
}

/** Creates a usable custom provider only when the completed form is saved. */
export interface CreateConfiguredCustomProviderRequest {
  name: string;
  baseURL: string;
  defaultModel: string;
  serviceModel: string;
  priority: number;
  apiKey: string;
}

/** `PATCH /v1/providers/custom/:id` — any subset of the instance's data. */
export interface UpdateCustomProviderRequest {
  name?: string;
  baseURL?: string;
  defaultModel?: string;
}

/**
 * `POST /v1/providers/:id/test` — a real one-prompt call against the
 * provider. Without a body it tests the stored key; with one, the key the
 * user just pasted and has not saved yet.
 */
export interface TestProviderRequest {
  apiKey?: string;
}

/** `POST /v1/transcribe` — recorded audio in, text out (the voice flow). */
export interface TranscribeRequest {
  /** The recording as a data URI (audio/webm, audio/mp4, audio/wav…). */
  dataUri: string;
}

export interface TranscribeResponse {
  ok: boolean;
  text?: string;
  /** Why it did not work, in words the user can act on. */
  message?: string;
}

export interface TestProviderResponse {
  ok: boolean;
  /** The provider's own words when it said no. */
  message?: string;
  /** Round-trip time of the probe, when it ran. */
  latencyMs?: number;
}

/**
 * Subscription sign-in (docs/specs/Spec-Pop-General.md §15, fase 1.5). The flow runs on the
 * server; the browser polls its transcript and answers at most one question.
 * No token material ever rides these shapes.
 */
export type OAuthEventDTO =
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

/** `POST /v1/providers/:id/oauth/start` — begins the login flow. */
export interface OAuthStartResponse {
  flowId: string;
}

/** `GET /v1/providers/:id/oauth/state` — the flow's transcript so far. */
export interface OAuthStateResponse {
  flowId: string;
  providerId: string;
  events: OAuthEventDTO[];
  /** The one question waiting for the user, when the flow asked one. */
  pending?: {
    type: 'text' | 'secret' | 'manual_code' | 'select';
    message: string;
    placeholder?: string;
    options?: { id: string; label: string; description?: string }[];
  };
  done: boolean;
  ok?: boolean;
  error?: string;
}

/** `POST /v1/providers/:id/oauth/input` — answers the pending question. */
export interface OAuthInputRequest {
  value: string;
}

/**
 * `POST /v1/events/ticket`. EventSource cannot send an Authorization header,
 * and a session token in a query string ends up in logs — so an authenticated
 * request trades it for this: good for one connection, for thirty seconds.
 */
