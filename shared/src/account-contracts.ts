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

/** `POST /v1/setup/acknowledge` — completes first-run setup after the key was saved. */
export interface SetupAcknowledgeResponse {
  setupDone: true;
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
  /** Password changes burn the previous recovery key. */
  recoveryKey: string;
}

/** `POST /v1/auth/sign-out-others` — every other session ends. */
export interface SignOutOthersResponse {
  token: string;
}

/**
 * `GET`/`PUT`/`PATCH /v1/settings`. PUT replaces the document; PATCH applies
 * an atomic field merge so independent controls cannot overwrite each other.
 *
 * Theme is absent by design: it belongs to the device, not the account
 * (docs/specs/Spec-Pop-General.md §14).
 */
export type PiUpdatePolicyDTO = 'keep-current' | 'recommended' | 'latest';

export interface SettingsDTO {
  language: 'en';
  /** Provider used when a chat does not choose its own (docs/specs/Spec-Pop-General.md §15). */
  defaultProvider: string;
  /** Model used when a chat does not choose its own. */
  defaultModel: string;
  /** Appended to the agent's system prompt. Empty means none. */
  customInstructions: string;
  /** whisper.cpp model for voice transcription (docs/specs/Spec-Pop-General.md §14). */
  voiceModel: string;
  /** Whether an LLM pass improves the raw transcript before it is used. */
  voiceCleanup: boolean;
  /** Model for that pass; empty means the service model. */
  voiceCleanupModel: string;
  /** Whether the reviewed background Auto-Skill pipeline is enabled (§8). */
  autoSkillsEnabled: boolean;
  /** Which pi release channel Pop Agent may evaluate (§15). */
  piUpdatePolicy: PiUpdatePolicyDTO;
}

/** Atomic field merge used by Settings controls; omitted fields are preserved. */
export type SettingsPatchDTO = Partial<SettingsDTO>;

/** `GET`/`PUT /v1/memory` — the living document Pop Agent keeps about the user. */
export interface UserMemoryDTO {
  doc: string;
  /** Whether a one-level backup exists to restore. */
  hasBackup: boolean;
}

/** A data-directory snapshot (docs/specs/Spec-Pop-General.md §16). */
export interface BackupDTO {
  name: string;
  size: number;
  createdAt: string;
}

export interface BackupsResponse {
  backups: BackupDTO[];
}

/**
 * `GET /v1/storage` — where the disk went (docs/specs/Spec-Pop-General.md §14). One line per kind
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
  /** Everything Pop Agent is responsible for, the backups included. */
  totalBytes: number;
  entries: StorageEntryDTO[];
  /** The filesystem holding the data directory, when the platform reports it. */
  disk?: { freeBytes: number; totalBytes: number };
}

/** `GET /v1/usage` — the cost dashboard (docs/specs/Spec-Pop-General.md §14). */
export interface UsageResponse {
  total: { runs: number; tokensIn: number; tokensOut: number; cost: number };
  byModel: { model: string; runs: number; cost: number }[];
  byDay: { day: string; cost: number }[];
}

/** A skill as Settings → Skills shows and edits it (docs/specs/Spec-Pop-General.md §8). */
export interface SkillDTO {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
  /**
   * Where the skill came from (docs/specs/Spec-Pop-General.md §8). `builtin` ships with the app and
   * cannot be deleted; `auto` was distilled from a conversation; `user` is the
   * user's own. Editing an auto skill promotes it to `user`.
   */
  source: "builtin" | "auto" | "user";
  /** A pinned skill sits in the session system prompt; the router skips it. */
  pinned?: boolean;

  /** Switched off by the user; absent means enabled. Built-ins can be disabled, not deleted. */
  enabled?: boolean;
  /** How many times the router has put this skill in front of the model (§8). */
  useCount?: number;
  /** ISO-8601 of the last time it did. Absent means never. */
  lastUsedAt?: string;
}

export interface SkillsResponse {
  skills: SkillDTO[];
  /** Retired by the collector: out of the router, still on disk (§8). */
  archived: SkillDTO[];
  /** A concise summary; detailed attempts live on their own paginated endpoint. */
  distiller: DistillerStatusDTO;
}

export interface SkillDistillationResultDTO {
  slug: string;
  disposition:
    | 'published_new'
    | 'published_revision'
    | 'policy_rejected'
    | 'contract_rejected'
    | 'evidence_rejected'
    | 'review_rejected'
    | 'protected_duplicate'
    | 'rejected';
  targetSlug?: string;
  reason?: 'slug_collision' | 'dedup_match';
  similarity?: number;
  overlap?: number;
  policyReasons?: string[];
  reviewReasons?: string[];
}

/** One attempt to learn from one bounded window of a conversation. */
export interface SkillDistillationAttemptDTO {
  id: string;
  chatId: string;
  chatTitle: string;
  trigger: 'automatic' | 'explicit_request' | 'manual_retry';
  state: 'queued' | 'running' | 'completed' | 'failed';
  outcome?: 'produced' | 'nothing' | 'tainted' | 'failed' | 'invalid_output';
  riskLevel?: 'suspicious' | 'high';
  warnings: string[];
  errorCode?: string;
  errorMessage?: string;
  retryOf?: string;
  startedAt: string;
  finishedAt?: string;
  results: SkillDistillationResultDTO[];
  retryable: boolean;
}

export interface SkillDistillationsResponse {
  attempts: SkillDistillationAttemptDTO[];
}

/**
 * What the Skills screen says about the background distiller. Deliberately
 * small: the cost of the feature already has a home in Settings → Usage, so
 * this is only "when did it last look" and "how much is waiting on you".
 */
export interface DistillerStatusDTO {
  enabled: boolean;
  /** ISO-8601 of the last conversation it finished. Absent means it never has. */
  lastRunAt?: string;
  candidates: number;
  published: number;
  policyRejected: number;
  reviewRejected: number;
  /** Enough real candidates were observed and every one died at the deterministic gate. */
  systematicBlocking: boolean;
}

// ---- Files as a plain folder (docs/specs/Spec-Pop-General.md §14, spec 1.58) ----

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

/** `GET /v1/update/status` — versions and whether newer pi/Pop Agent exist (docs/specs/Spec-Pop-General.md §15). */
export type PiCandidatePhaseDTO =
  | 'idle'
  | 'installing'
  | 'validating'
  | 'ready'
  | 'waiting-idle'
  | 'activating'
  | 'active'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed';

export interface PiCandidateStatusDTO {
  phase: PiCandidatePhaseDTO;
  version?: string;
  integrity?: string;
  error?: string;
  updatedAt?: string;
}

export interface UpdateStatusResponse {
  pi: { current: string; recommended: string; latest?: string; candidate?: PiCandidateStatusDTO };
  popAgent: { current: string; latest?: string };
  node: string;
  /** Environment tool versions (whisper, ffmpeg, poppler, tesseract). */
  environment: { name: string; version: string }[];
  updateCommand: string;
  /** The checkout running now versus the committed checkout ready on disk. */
  deployment?: {
    runningCommit: string;
    headCommit: string;
    lastKnownGood: string;
    pending: boolean;
    clean: boolean;
    /** Current HEAD's tree exactly matches a recent successful gate receipt. */
    prepared: boolean;
    phase:
      | 'current'
      | 'pending'
      | 'waiting-idle'
      | 'restarting'
      | 'healthy'
      | 'rolling-back'
      | 'rolled-back'
      | 'cancelled'
      | 'superseded'
      | 'failed';
    requestedBy?: 'manual' | 'automatic';
    error?: string;
    failedRef?: string;
  };
}

/** `POST /v1/update/restart-when-idle` — hand a committed checkout to the supervisor. */
export type DeploymentRequestResponse =
  | { ok: true; deployment: NonNullable<UpdateStatusResponse['deployment']> }
  | {
      ok: false;
      reason: 'already_current' | 'dirty_tree' | 'not_prepared' | 'already_scheduled';
    };

export type DeploymentCancelResponse = { ok: true } | { ok: false; reason: 'not_waiting' };

/** `POST /v1/update/pi/prepare` — stage and validate the policy target. */
export type PiCandidatePrepareResponse =
  | { ok: true; candidate: PiCandidateStatusDTO }
  | {
      ok: false;
      reason: 'policy_keeps_current' | 'target_unavailable' | 'already_running';
    };

/** `POST /v1/update/pi/activate` — drain and externally activate a ready candidate. */
export type PiCandidateActivateResponse =
  | { ok: true; candidate: PiCandidateStatusDTO }
  | {
      ok: false;
      reason: 'candidate_not_ready' | 'already_current' | 'already_scheduled';
    };

/** `GET /v1/about` — what Settings → About shows. */
export interface AboutResponse {
  popAgentVersion: string;
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
  /** Bytes on the partition holding POP_AGENT_DATA_DIR. */
  disk: { total: number | null; free: number | null };
  uptimeSeconds: number;
  processUptimeSeconds: number;
  timezone: string;
  serverTime: string;
  nodeVersion: string;
  popAgentVersion: string;
  /** Short git commit of the running checkout, 'unknown' outside a clone. */
  commit: string;
  dbBytes: number | null;
  workspaceBytes: number | null;
  dataDir: string;
  workspace: string;
}

/**
 * `GET /v1/health` — the sidebar's silence-means-healthy probe (docs/specs/Spec-Pop-General.md
 * §13). Public, cheap, cached signals only: a missing answer means
 * "Server offline", an `error` field means connected-but-degraded.
 */
export interface HealthResponse {
  server: 'ok';
  provider: 'ok' | 'error';
  db: 'ok' | 'error';
}
