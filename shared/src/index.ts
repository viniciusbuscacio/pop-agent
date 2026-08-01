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

/**
 * An artifact as the artifacts screen lists it (popy.spec §14, RF-002). The
 * `id` is the only handle a client ever sees — no filesystem path or storage
 * key (RF-008).
 */
export interface ArtifactDTO {
  id: string;
  /** Empty when the file was uploaded straight into Files. */
  chatId: string;
  /** Empty means the root of Files. */
  folderId: string;
  name: string;
  mime: string;
  size: number;
  version: number;
  source: 'agent' | 'upload';
  createdAt: string;
}

/** A folder in Files (flat tree). */
export interface FolderDTO {
  id: string;
  name: string;
  createdAt: string;
}

export interface FoldersResponse {
  folders: FolderDTO[];
}

export interface ArtifactsResponse {
  artifacts: ArtifactDTO[];
}

/** One entry in an artifact's version history (popy.spec §14, RF-018/019). */
export interface ArtifactVersionDTO {
  version: number;
  mime: string;
  size: number;
  source: 'agent' | 'upload';
  createdAt: string;
}

export interface ArtifactVersionsResponse {
  versions: ArtifactVersionDTO[];
}

/** `POST /v1/artifacts/:id/link` — a fresh HMAC-signed download URL (RF-004). */
export interface ArtifactLinkResponse {
  url: string;
  expiresAt: number;
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
  /** Files already in Files, referenced by @ in the composer. */
  artifactIds?: string[];
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

/**
 * `GET /v1/providers` — whether each provider can be used, never the key
 * itself. `source` says where the key came from, because a key set by the
 * environment cannot be cleared from the UI.
 */
export interface ProviderStatusDTO {
  id: string;
  name: string;
  configured: boolean;
  source: 'settings' | 'env' | null;
  defaultModel: string;
  allowCustomModel: boolean;
  /** The custom provider's endpoint; never a secret (popy.spec §15). */
  baseURL?: string;
}

export interface ProvidersResponse {
  providers: ProviderStatusDTO[];
}

/** `PUT /v1/providers/:id/key` — write-only: no route ever returns the key. */
export interface SetProviderKeyRequest {
  apiKey: string;
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
