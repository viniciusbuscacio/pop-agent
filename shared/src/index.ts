/**
 * Types shared between server and web. The web app never redefines a
 * server type — it imports from here (popy.spec §3, §13).
 */

/** Structured API error body. Codes are stable (popy.spec §13). */
export interface ApiError {
  error: {
    code: string;
    message: string;
    status: number;
  };
}

/** 423 from the credential routes: how long the progressive lockout still runs. */
export interface LockedError extends ApiError {
  retryAfterSeconds: number;
}

/**
 * Response header carrying a refreshed session token. The API renews a token
 * that is over a day old; the client swaps whatever it stored when it sees
 * this (popy.spec §9).
 */
export const SESSION_TOKEN_HEADER = 'x-popy-token';

/**
 * Which client sent a request (popy.spec §13). Set once in each client's API
 * layer, so every call carries it -- including the ones nobody has written
 * yet -- and recorded on the message so the history remembers where each turn
 * happened, not just where this one is.
 *
 * Deliberately NOT called `source`: that name is already two other things in
 * Popy (an artifact is `agent`/`upload`, a chat title is `auto`/`manual`).
 *
 * A client with a token can forge this, and on a single-user install that
 * means the owner lying to himself. It is context, never a security decision.
 */
export const CLIENT_HEADER = 'x-popy-client';
export const CLIENT_PLATFORM_HEADER = 'x-popy-client-platform';

/**
 * The terminal that typed this message, named by the id its hands channel
 * gave it on attach (docs/cli.md, Whose hands).
 *
 * On the message and not on the chat: the hands belong to whoever is typing,
 * so a laptop that is shut is never reachable through a message sent from the
 * phone, and a conversation answered from two machines stays legible when it
 * is read back later.
 *
 * Only the CLI sends it. An unknown or departed id is not an error -- the run
 * simply has the server's tools, exactly like a message from the PWA.
 */
export const HANDS_HEADER = 'x-popy-hands';

/**
 * The oldest `popy` this server will talk to (docs/cli.md, Version
 * compatibility).
 *
 * Set BY HAND, and moved only when the wire changes in a way an older client
 * cannot survive -- the REST shapes, the StreamEvent shapes, the hands
 * frames. Most releases do not touch it, which is the point: a version number
 * that rises every release blocks clients that were working fine.
 *
 * It lives here and nowhere else. There is no endpoint for a client to
 * consult beforehand and no copy shipped inside the client: the client learns
 * the answer by attaching and being told, so the two can never disagree.
 */
export const MIN_CLIENT_VERSION = '0.2.0';

/**
 * Compares two `major.minor.patch` strings. Negative when `a` is older.
 *
 * Deliberately not semver-complete: Popy's own versions have no pre-release
 * or build metadata, and a dependency to compare three integers would be a
 * dependency to keep.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string): number[] =>
    value
      .split('.')
      .slice(0, 3)
      .map((piece) => Number.parseInt(piece, 10))
      .map((piece) => (Number.isFinite(piece) ? piece : 0));
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The command that installs this server's own client (docs/cli.md). */
export function installCommand(origin: string, version: string): string {
  // The version is in the FILENAME because npm caches by URL: without it an
  // update silently reinstalls whatever was fetched the first time.
  return `npm i -g ${origin.replace(/\/$/, '')}/cli-${version}.tgz`;
}

/**
 * `web` is a browser tab; `pwa` the same app installed and running
 * standalone; `desktop` the embedded shell (not built yet). `mobile` is
 * absent on purpose -- it is a shape of screen, not a client, and lives in
 * the platform instead, or "PWA on an iPhone" would be two answers at once.
 */
export const CLIENT_KINDS = ['web', 'pwa', 'desktop', 'cli', 'api', 'task'] as const;
export type ClientKind = (typeof CLIENT_KINDS)[number];

export function isClientKind(value: string): value is ClientKind {
  return (CLIENT_KINDS as readonly string[]).includes(value);
}

export * from './mcp.js';

/** `GET /v1/auth/state` — decides between the setup wizard and the login screen. */
export interface AuthStateResponse {
  setupDone: boolean;
}

/** `POST /v1/setup` — first run only. */
export interface SetupRequest {
  password: string;
}

/** The only moment the recovery key exists in the clear. */
export interface SetupResponse {
  recoveryKey: string;
  token: string;
}

/** `POST /v1/login` — vault-style: password only, no user name. */
export interface LoginRequest {
  password: string;
}

export interface LoginResponse {
  token: string;
}

/** `POST /v1/auth/recover` — the recovery key is spent and replaced. */
export interface RecoverRequest {
  recoveryKey: string;
  newPassword: string;
}

export interface RecoverResponse {
  token: string;
  /** A fresh key: the one just used no longer works. */
  recoveryKey: string;
}

/** `POST /v1/auth/change-password` — other devices drop, this one stays. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface ChangePasswordResponse {
  token: string;
}

/** `POST /v1/auth/sign-out-others` — every other session ends. */
export interface SignOutOthersResponse {
  token: string;
}

/**
 * `GET`/`PUT /v1/settings`. PUT takes the whole document -- there is no
 * partial merge -- and rejects any field it does not know.
 *
 * Theme is absent by design: it belongs to the device, not the account
 * (popy.spec §14).
 */
export interface SettingsDTO {
  language: 'en';
  /** Provider used when a chat does not choose its own (popy.spec §15). */
  defaultProvider: string;
  /** Model used when a chat does not choose its own. */
  defaultModel: string;
  /** Model for background jobs: titles, summaries (popy.spec §15). */
  serviceModel: string;
  /** Appended to the agent's system prompt. Empty means none. */
  customInstructions: string;
  /** whisper.cpp model for voice transcription (popy.spec §14). */
  voiceModel: string;
  /** Whether an LLM pass improves the raw transcript before it is used. */
  voiceCleanup: boolean;
  /** Model for that pass; empty means the service model. */
  voiceCleanupModel: string;
}

/** `GET`/`PUT /v1/memory` — the living document Popy keeps about the user. */
export interface UserMemoryDTO {
  doc: string;
  /** Whether a one-level backup exists to restore. */
  hasBackup: boolean;
}

/** A data-directory snapshot (popy.spec §16). */
export interface BackupDTO {
  name: string;
  size: number;
  createdAt: string;
}

export interface BackupsResponse {
  backups: BackupDTO[];
}

/**
 * `GET /v1/storage` — where the disk went (popy.spec §14). One line per kind
 * of weight, measured before any quota exists, because a limit chosen without
 * looking is a guess about which line is the expensive one.
 */
export type StorageKeyDTO =
  | 'files'
  | 'index'
  | 'database'
  | 'models'
  | 'workspace'
  | 'other'
  | 'backups';

export interface StorageEntryDTO {
  key: StorageKeyDTO;
  bytes: number;
  /** How many things the line counts, where counting means anything. */
  count?: number;
}

export interface StorageResponse {
  /** Everything Popy is responsible for, the backups included. */
  totalBytes: number;
  entries: StorageEntryDTO[];
  /** The filesystem holding the data directory, when the platform reports it. */
  disk?: { freeBytes: number; totalBytes: number };
}

/** `GET /v1/usage` — the cost dashboard (popy.spec §14). */
export interface UsageResponse {
  total: { runs: number; tokensIn: number; tokensOut: number; cost: number };
  byModel: { model: string; runs: number; cost: number }[];
  byDay: { day: string; cost: number }[];
}

/** A skill as Settings → Skills shows and edits it (popy.spec §8). */
export interface SkillDTO {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
  /** Built-in skills can be edited but not deleted. */
  builtin: boolean;
  /** A pinned skill sits in the session system prompt; the router skips it. */
  pinned?: boolean;
}

export interface SkillsResponse {
  skills: SkillDTO[];
}

// ---- Files as a plain folder (popy.spec §14, spec 1.58) ----

/**
 * One entry of the Files tree (`GET /v1/files`): the disk as it is. The path
 * is relative to the Files root and IS the identifier -- there are no ids.
 */
export interface FileNodeDTO {
  name: string;
  /** Relative to the Files root, `/`-separated: `reports/pesca.pdf`. */
  path: string;
  kind: 'file' | 'dir';
  /** Bytes for a file; 0 for a folder. */
  size: number;
  /** ISO timestamp of the last modification. */
  mtime: string;
  /** Present on folders only. */
  children?: FileNodeDTO[];
}

export interface FilesTreeResponse {
  tree: FileNodeDTO[];
}

/** `GET /v1/files/search?q=`: live name matches, no index behind them. */
export interface FilesNameSearchResponse {
  hits: { path: string; kind: 'file' | 'dir' }[];
}

/** `POST /v1/files/link`: the signed URL the browser downloads through. */
export interface FileLinkResponse {
  url: string;
  expiresAt: number;
}

/** One entry of `GET /v1/trash`: something in Files/Garbage/. */
export interface GarbageEntryDTO {
  /** The entry's name inside Garbage/ -- the handle for restore and purge. */
  name: string;
  /** Where it lived; restore puts it back there. */
  originalPath: string;
  kind: 'file' | 'dir';
  size: number;
  deletedAt: string;
  /** ISO instant after which the daily sweep may purge it. */
  purgeAt: string;
}

export interface GarbageResponse {
  entries: GarbageEntryDTO[];
}

/** `POST`/`PUT /v1/skills` — create or replace a skill. */
export interface SaveSkillRequest {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
  pinned?: boolean;
}

/** `GET /v1/update/status` — versions and whether newer pi/Popy exist (popy.spec §15). */
export interface UpdateStatusResponse {
  pi: { current: string; latest?: string };
  popy: { current: string; latest?: string };
  node: string;
  /** Environment tool versions (whisper, ffmpeg, poppler, tesseract). */
  environment: { name: string; version: string }[];
  updateCommand: string;
}

/** `GET /v1/about` — what Settings → About shows. */
export interface AboutResponse {
  popyVersion: string;
  nodeVersion: string;
  piVersion: string;
}

/**
 * `GET /v1/server/info` — Settings → Server. Every field is best-effort:
 * `null`/`'unknown'` means "could not measure", never a failed request.
 */
export interface ServerInfoResponse {
  /**
   * Whether the operator has the LLM switched off (Stop LLM). Carried here so
   * the danger zone can label its switch truthfully after a reload -- a
   * button that says "Restart" while the model is off is the confusion the
   * zone exists to avoid.
   */
  llmStopped?: boolean;
  cpu: { model: string; cores: number; load: number[] };
  memory: { total: number; used: number };
  /** Bytes on the partition holding POPY_DATA_DIR. */
  disk: { total: number | null; free: number | null };
  uptimeSeconds: number;
  processUptimeSeconds: number;
  timezone: string;
  serverTime: string;
  nodeVersion: string;
  popyVersion: string;
  /** Short git commit of the running checkout, 'unknown' outside a clone. */
  commit: string;
  dbBytes: number | null;
  workspaceBytes: number | null;
  dataDir: string;
  workspace: string;
}

/**
 * `GET /v1/health` — the sidebar's silence-means-healthy probe (popy.spec
 * §13). Public, cheap, cached signals only: a missing answer means
 * "Server offline", an `error` field means connected-but-degraded.
 */
export interface HealthResponse {
  server: 'ok';
  provider: 'ok' | 'error';
  db: 'ok' | 'error';
}

/** A conversation, as the sidebar and the chat header see it. */
export interface ChatDTO {
  id: string;
  title: string;
  /** Empty means "whatever the default model is". */
  model: string;
  /** Empty means "whatever the default provider is" (popy.spec §15). */
  provider: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  /** Last message, for the list. Empty for a chat nobody has written in. */
  preview: string;
}

export interface ChatListResponse {
  chats: ChatDTO[];
}

/** What a tool call left behind, as rendered in a reloaded conversation. */
export interface ToolCallDTO {
  name: string;
  status: 'start' | 'output' | 'done' | 'error';
  detail: string;
}

export interface MessageDTO {
  id: string;
  chatId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking: string;
  tools: ToolCallDTO[];
  attachments: AttachmentDTO[];
  createdAt: string;
}

/**
 * The run in flight for a chat, as of this response (aw's partial-reply
 * buffer, ported). A client that mounts mid-run seeds its live view from this
 * instead of waiting for the next fragment; `seq` says how much of the stream
 * the snapshot already contains, so fragments are never counted twice.
 */
export interface LiveRunDTO {
  runId: string;
  status: 'queued' | 'running';
  /** Sequence number of the last fragment folded into this snapshot. */
  seq: number;
  content: string;
  thinking: string;
  tools: ToolCallDTO[];
}

export interface MessagesResponse {
  messages: MessageDTO[];
  /** Present while this chat has a run in flight. */
  live?: LiveRunDTO;
}

/** `PATCH /v1/chats/:id` — send only what changes. */
export interface PatchChatRequest {
  title?: string;
  archived?: boolean;
  model?: string;
  /** Must travel with `model`: the identity is the pair (popy.spec §15). */
  provider?: string;
}

/**
 * A file sent with a message (popy.spec §6, aw's shape). The data URI is the
 * whole payload: stored on the message row, rendered from there, and written
 * into the agent's workspace so its tools can read the file.
 */
export interface AttachmentDTO {
  name: string;
  type: string;
  dataUri: string;
}

/** Body of `POST /v1/chats/:id/messages` (docs/agent-flow.md). */
export interface SendMessageRequest {
  text: string;
  attachments?: AttachmentDTO[];
  /** Files already in Files, referenced by @ in the composer, by path. */
  filePaths?: string[];
}

/** 202 response of `POST /v1/chats/:id/messages`: the run has started. */
export interface SendMessageResponse {
  runId: string;
  userMessageId: string;
}

/** `POST /v1/chats/:id/stop` — false when there was nothing to stop. */
export interface StopRunResponse {
  stopped: boolean;
}

/** `POST /v1/chats/:id/confirm` — answers a paused risky action (popy.spec §10). */
export interface ConfirmRequest {
  runId: string;
  allow: boolean;
}

export interface ConfirmResponse {
  /** False when there was no pending confirmation to answer. */
  answered: boolean;
}

/**
 * A background task as the Tasks screen shows it (popy.spec §21). Times are
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
}

/** `PATCH /v1/tasks/:id` — every field optional, the rest is left alone. */
export interface UpdateTaskRequest {
  title?: string;
  prompt?: string;
  scheduleKind?: TaskScheduleKindDTO;
  intervalMinutes?: number;
  notifyOnFinish?: boolean;
  archiveChat?: boolean;
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

/** Where the catalog came from, freshest first (aw's honest-source label). */
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
  allowCustomModel: boolean;
  /** A custom instance's endpoint; never a secret (popy.spec §15). */
  baseURL?: string;
  /** True for a user-created custom instance: editable, deletable. */
  custom?: boolean;
  /** Position in the priority list, 1-based. #1 is the global default. */
  order: number;
  /** The user's on/off switch: a disabled provider never serves a run. */
  enabled: boolean;
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

/** `PUT /v1/providers/:id/key` — write-only: no route ever returns the key. */
export interface SetProviderKeyRequest {
  apiKey: string;
}

/**
 * Unlimited custom OpenAI-compatible providers (popy.spec §15). An instance
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

/** `POST /v1/transcribe` — recorded audio in, text out (aw's voice flow). */
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
 * Subscription sign-in (popy.spec §15, fase 1.5). The flow runs on the
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
export interface EventTicketResponse {
  ticket: string;
}

/**
 * Events delivered over the single SSE channel `GET /v1/events`. Fragments
 * (`delta`, `thinking`, `tool`) carry a per-run `seq` so a client holding a
 * live snapshot can drop what the snapshot already contains.
 */
export type StreamEvent =
  | { kind: 'delta'; chatId: string; runId: string; seq: number; text: string }
  | { kind: 'thinking'; chatId: string; runId: string; seq: number; text: string }
  | {
      kind: 'tool';
      chatId: string;
      runId: string;
      seq: number;
      name: string;
      status: 'start' | 'output' | 'done' | 'error';
      detail?: string;
    }
  | { kind: 'done'; chatId: string; runId: string; messageId: string }
  | { kind: 'error'; chatId: string; runId: string; code: string }
  | { kind: 'title'; chatId: string; title: string }
  /** A risky action is paused mid-run, waiting for Allow or Deny (popy.spec §10). */
  | { kind: 'confirm'; chatId: string; runId: string; action: string; detail: string }
  /** Whether a run is waiting for a slot or actually talking to the engine. */
  | { kind: 'run-status'; chatId: string; runId: string; status: 'queued' | 'running' }
  | { kind: 'update'; status: 'available' | 'installing' | 'done' | 'error' };
