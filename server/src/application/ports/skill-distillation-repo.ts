/**
 * What the background distiller has to remember between ticks (pop-agent.spec §8,
 * auto-skill fase c).
 *
 * Two things, and they are different in kind. The **watermark** is how far into
 * each conversation the distiller has already looked: a mark per chat, not a
 * boolean, because a conversation that was checked and then continued has to
 * come back -- with only its new messages. The **revisions** are proposals to
 * change a skill that already exists, held here instead of being written into
 * the vault, so the approved version stays live in the router until the user
 * accepts the new one.
 *
 * The revision table is what makes the approval promise whole. Without it the
 * pending flag on a new skill guards the front door while the update path is
 * left open, and an injection distilled as "a better version of a skill you
 * already trust" would walk straight in.
 */

export interface Watermark {
  chatId: string;
  /** The last message id the distiller has considered in this chat. */
  messageId: string;
  /** ISO-8601: when that mark was set. The Skills screen reads the latest. */
  at: string;
}

export type DistillationTrigger = 'automatic' | 'explicit_request' | 'manual_retry';
export type DistillationState = 'queued' | 'running' | 'completed' | 'failed';
export type DistillationOutcome = 'produced' | 'nothing' | 'tainted' | 'failed' | 'invalid_output';
export type DistillationDisposition =
  | 'published_new'
  | 'published_revision'
  | 'policy_rejected'
  | 'contract_rejected'
  | 'evidence_rejected'
  | 'review_rejected'
  | 'protected_duplicate'
  | 'rejected';

export interface DistillationResult {
  slug: string;
  disposition: DistillationDisposition;
  targetSlug?: string;
  reason?: 'slug_collision' | 'dedup_match';
  similarity?: number;
  overlap?: number;
  policyReasons?: string[];
  reviewReasons?: string[];
}

/** One durable account of one bounded conversation window. */
export interface DistillationAttempt {
  id: string;
  chatId: string;
  chatTitle: string;
  fromMessageId?: string;
  throughMessageId: string;
  trigger: DistillationTrigger;
  requested: boolean;
  state: DistillationState;
  outcome?: DistillationOutcome;
  riskLevel?: 'suspicious' | 'high';
  warnings: string[];
  errorCode?: string;
  errorMessage?: string;
  retryOf?: string;
  startedAt: string;
  finishedAt?: string;
  results: DistillationResult[];
}

export interface StartDistillationAttempt {
  id: string;
  chatId: string;
  chatTitle: string;
  fromMessageId?: string;
  throughMessageId: string;
  trigger: DistillationTrigger;
  requested: boolean;
  state?: 'queued' | 'running';
  retryOf?: string;
  startedAt: string;
}

export interface FinishDistillationAttempt {
  state: 'completed' | 'failed';
  outcome: DistillationOutcome;
  finishedAt: string;
  riskLevel?: 'suspicious' | 'high';
  warnings?: string[];
  errorCode?: string;
  errorMessage?: string;
  results?: DistillationResult[];
}

export interface DistillationRepo {
  get(chatId: string): Watermark | undefined;

  /**
   * Moves the mark. Called on every outcome except a provider failure -- a
   * tainted window, an empty answer and a skill written all advance it, so the
   * queue drains; an LLM error deliberately does not, so the next tick retries
   * that conversation for free.
   */
  set(chatId: string, messageId: string, at: string): void;

  /** When the distiller last finished a conversation, for the status line. */
  lastRunAt(): string | undefined;

  /** Drops the mark for chats that no longer exist. Attempts remain as history. */
  keepOnly(chatIds: readonly string[]): void;

  startAttempt(attempt: StartDistillationAttempt): void;
  finishAttempt(id: string, finish: FinishDistillationAttempt): void;
  attempt(id: string): DistillationAttempt | undefined;
  attempts(limit: number): DistillationAttempt[];
  /** Oldest manual retry waiting for the distiller, if any. */
  nextQueuedAttempt(): DistillationAttempt | undefined;
  markAttemptRunning(id: string, at: string): void;
  /** Clones an exact old window into the retry queue. */
  queueRetry(sourceId: string, id: string, at: string): DistillationAttempt | undefined;
}

/** A proposed rewrite of a skill that already exists, waiting on the user. */
export interface SkillRevision {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
  createdAt: string;
  /**
   * The measured cosine between the candidate's routing text and the skill it
   * would replace -- the column exists to retune the dedup bars, so only a
   * real measurement is written. Absent when nothing was measured: a revision
   * proposed on a slug collision without an embedder has no cosine to record.
   */
  similarity?: number;
}

export interface SkillRevisionsRepo {
  all(): SkillRevision[];
  get(slug: string): SkillRevision | undefined;
  /** One proposal per skill: a newer one replaces an unreviewed older one. */
  save(revision: SkillRevision): void;
  delete(slug: string): void;
}
