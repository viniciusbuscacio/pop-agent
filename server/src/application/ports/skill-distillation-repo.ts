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

  /** Drops the mark for chats that no longer exist. */
  keepOnly(chatIds: readonly string[]): void;
}

/** A proposed rewrite of a skill that already exists, waiting on the user. */
export interface SkillRevision {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
  createdAt: string;
  /** How close the distiller judged it to the skill it would replace (§10: 0.90). */
  similarity: number;
}

export interface SkillRevisionsRepo {
  all(): SkillRevision[];
  get(slug: string): SkillRevision | undefined;
  /** One proposal per skill: a newer one replaces an unreviewed older one. */
  save(revision: SkillRevision): void;
  delete(slug: string): void;
}
