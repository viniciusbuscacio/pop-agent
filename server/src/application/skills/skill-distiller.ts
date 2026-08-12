import type { Chat, Message } from '../../domain/chat/chat.js';
import { entityId } from '../../domain/ids.js';
import { sanitize } from '../../domain/safety/sanitize.js';
import {
  buildDistillPrompt,
  candidateRoutingText,
  hasUsableRouting,
  parseDistillAnswer,
  scrubCandidate,
  type SkillCandidate,
} from '../../domain/skills/distillation.js';
import { vocabularyOverlap } from '../../domain/skills/skill-router.js';
import {
  buildReviewPrompt,
  parseReviewAnswer,
  reviewHash,
  runPolicyGate,
  satisfiesEnglishContract,
  skillVersionHash,
  type ReviewEnvelope,
} from '../../domain/skills/auto-skill-review.js';
import { asksForSkill } from '../../domain/skills/skill-request.js';
import type { ChatRepo } from '../ports/chat-repo.js';
import type { Clock } from '../ports/clock.js';
import type { Embedder } from '../ports/embedder.js';
import type { MaintenanceJob } from '../ports/maintenance-job.js';
import type {
  DistillationRepo,
  DistillationResult,
  SkillRevisionsRepo,
} from '../ports/skill-distillation-repo.js';
import type { SkillVectorsRepo } from '../ports/skill-vectors-repo.js';
import { SkillsError, type SkillsRepo } from '../ports/skills-repo.js';

/**
 * The background distiller (pop-agent.spec §8, auto-skill fase c): the half of
 * auto-skill nobody has to ask for. Fase (b) waits for "vira skill"; this
 * reads the conversations that ended without anyone thinking to say it.
 *
 * **One conversation per tick**, and that is the whole cost model. A tick with
 * nothing idle and unread spends nothing at all -- no provider call is made --
 * so the bill follows use and disappears when use does. When there is
 * something, it is exactly one small completion. The queue drains on its own
 * at one conversation per interval, which is faster than a single user
 * produces conversations.
 *
 * **The watermark moves on every outcome except a provider failure.** Tainted,
 * empty, or three skills written: all advance it, because all three mean "this
 * window has been considered". Only an LLM error leaves it behind, so the next
 * tick retries for free. A distiller whose mark advanced on failure would
 * silently skip conversations whenever a provider had a bad minute.
 *
 * **A tainted window is never distilled.** The check is `sanitize` -- the same
 * function the live taint guard uses -- run over the window before the model
 * sees it, and it is deliberately conservative: anything not `low` skips the
 * whole conversation. Fase (b) is protected by the taint guard refusing
 * `skill_write` mid-turn, but nothing guards a turn that already ended, and a
 * skill is the one artefact that outlives its turn. This is that guard.
 *
 * **A match against an existing Auto-Skill becomes a reviewed revision.**
 * The old file is durably backed up before the prepared replacement appears;
 * Built-in and Personal matches terminate as protected duplicates.
 */

/** A conversation the distiller has decided to read, and why. */
interface Target {
  chat: Chat;
  window: Message[];
  /** The mark immediately before this bounded window, absent on the first read. */
  fromMessageId?: string;
  /** The user asked for a skill here, in so many words. */
  requested: boolean;
  /** Present when this target was cloned from a manual retry request. */
  attemptId?: string;
}

/** How long a conversation must sit still before it is fair game. */
const DEFAULT_IDLE_MS = 5 * 60_000;

/** The window handed to the model; the tail of the conversation after the mark. */
const WINDOW = 60;

/**
 * Cosine above which a candidate is judged to be the same skill as one that
 * already exists (§10: start at 0.90, log every comparison, retune with data).
 */
export const DEDUP_THRESHOLD = 0.88;

/**
 * ...and how much vocabulary they must share as well. Measured 08/08 over the
 * real vault: 378 pairs of distinct skills against 36 pairs of known
 * duplicates (the nine re-distillations the broken index let through).
 *
 * Cosine alone cannot do it -- the two distributions overlap from 0.895 to
 * 0.936. That overlap is not academic: it filed a good "Restart Pop Agent service"
 * skill as a revision of `self-change` at 0.9017, where accepting it would
 * have replaced an unrelated skill and rejecting it hid the new one in a table.
 * With the second bar, `0.88 / 0.20` catches 32 of the 36 duplicates and merges
 * **none** of the 378 distinct pairs; `0.90` alone caught 35 and merged 27.
 * Precision first: a missed duplicate is one extra card to say no to, while a
 * wrong merge hides a good skill behind a diff against something else.
 */
export const DEDUP_MIN_OVERLAP = 0.25;

export interface SkillDistillerDeps {
  chats: ChatRepo;
  marks: DistillationRepo;
  revisions: SkillRevisionsRepo;
  skills: SkillsRepo;
  /** Without an embedder the dedup leg is off and only a slug collision is an update. */
  embedder?: Embedder;
  vectors?: SkillVectorsRepo;
  /** Creator and reviewer are separate service completions with fresh contexts. */
  complete: (
    request: { prompt: string; maxTokens: number },
    context: { provider?: string; purpose: 'auto_skill_creator' | 'auto_skill_reviewer' },
  ) => Promise<string>;
  clock: Clock;
  /** Read per tick, so Settings takes effect on the next one, not the next boot. */
  enabled: () => boolean;
  everyMs: () => number;
  idleMs?: number;
  onJournal?: (line: string) => void;
}

/**
 * How many tokens one distillation may answer with.
 *
 * Raised from 2000 after the first live run: the ceiling has to cover the
 * model's reasoning as well as its answer, and a thinking model can spend most
 * of it before writing a character of JSON. Two thousand truncated a single
 * skill. This is still one small call -- the prompt is the expensive half, and
 * the cap only binds when there is genuinely a lot to say.
 */
const MAX_ANSWER_TOKENS = 6_000;

export class SkillDistiller implements MaintenanceJob {
  readonly name = 'skill-distiller';

  constructor(private readonly deps: SkillDistillerDeps) {}

  /**
   * A getter, not a field: the interval lives in Settings, and the scheduler
   * reads this property on every tick. Changing the cadence therefore takes
   * effect immediately instead of at the next restart.
   */
  get everyMs(): number {
    return this.deps.everyMs();
  }

  async run(): Promise<void> {
    if (!this.deps.enabled()) return;

    const chats = [
      ...this.deps.chats.list({ archived: false }),
      ...this.deps.chats.list({ archived: true }),
    ];
    this.deps.marks.keepOnly(chats.map((chat) => chat.id));

    const target = this.pick(chats);
    if (target === undefined) return;

    const { chat, window, requested } = target;
    const lastId = window[window.length - 1]!.id;
    const now = (): string => new Date(this.deps.clock.now()).toISOString();
    const attemptId = target.attemptId ?? entityId('distillation');
    if (target.attemptId === undefined) {
      this.deps.marks.startAttempt({
        id: attemptId,
        chatId: chat.id,
        chatTitle: chat.title,
        ...(target.fromMessageId === undefined ? {} : { fromMessageId: target.fromMessageId }),
        throughMessageId: lastId,
        trigger: requested ? 'explicit_request' : 'automatic',
        requested,
        startedAt: now(),
      });
    }
    const journal = (line: string): void => this.deps.onJournal?.(`pop distiller: ${line}`);
    const finish = (
      value: Parameters<DistillationRepo['finishAttempt']>[1],
    ): void => this.deps.marks.finishAttempt(attemptId, value);

    // Conservative by design: one suspicious tool result anywhere in the window
    // and the whole conversation is skipped, permanently. Store only warning
    // labels, never the hostile source text that produced them.
    const externalContent = window.map((message) => externalContentOf(message)).join('\n');
    const verdict = sanitize(externalContent);
    if (verdict.riskLevel !== 'low') {
      this.advanceTarget(target, lastId);
      finish({
        state: 'completed',
        outcome: 'tainted',
        riskLevel: verdict.riskLevel,
        warnings: verdict.warnings,
        finishedAt: now(),
      });
      journal(`chat=${chat.id} skipped (tainted: ${verdict.riskLevel})`);
      return;
    }

    let answer: string;
    try {
      answer = await this.deps.complete(
        {
          prompt: buildDistillPrompt(
            window,
            this.deps.skills.all().map((skill) => ({ slug: skill.slug, description: skill.description })),
            requested,
          ),
          maxTokens: MAX_ANSWER_TOKENS,
        },
        { provider: chat.provider, purpose: 'auto_skill_creator' },
      );
    } catch (error) {
      const message = safeError(error);
      finish({ state: 'failed', outcome: 'failed', errorCode: 'provider_failure', errorMessage: message, finishedAt: now() });
      // The one outcome that does NOT move the mark.
      journal(`chat=${chat.id} failed (${message})`);
      return;
    }

    const parsed = parseDistillAnswer(answer);
    if (parsed.candidates.length === 0) {
      if (parsed.truncated) {
        finish({ state: 'failed', outcome: 'failed', errorCode: 'truncated_answer', errorMessage: 'The model answer ended before its closing marker.', finishedAt: now() });
        journal(`chat=${chat.id} answer truncated, nothing salvaged; will retry`);
        return;
      }
      const invalid = parsed.invalidBlocks > 0 || !parsed.explicitEmpty;
      this.advanceTarget(target, lastId);
      finish({
        state: 'completed',
        outcome: invalid ? 'invalid_output' : 'nothing',
        ...(invalid
          ? {
              errorCode: 'invalid_answer',
              errorMessage: 'The model answer contained no complete valid skill.',
            }
          : {}),
        finishedAt: now(),
      });
      journal(`chat=${chat.id} ${invalid ? 'invalid answer' : 'nothing to learn'}${requested ? ' (asked for one)' : ''}`);
      return;
    }

    const stagedOperations: string[] = [];
    try {
      const evidenceIds = new Set(window.map((message) => message.id));
      const results: DistillationResult[] = [];
      const prepared: PreparedCandidate[] = [];
      for (const raw of parsed.candidates) {
        if (!satisfiesEnglishContract(raw)) {
          results.push({ slug: raw.slug, disposition: 'contract_rejected' });
          continue;
        }
        if ((raw.evidence ?? []).length === 0 || raw.evidence?.some((id) => !evidenceIds.has(id))) {
          results.push({ slug: raw.slug, disposition: 'evidence_rejected' });
          continue;
        }
        const policy = runPolicyGate(raw);
        if (!policy.allowed) {
          results.push({ slug: raw.slug, disposition: 'policy_rejected', policyReasons: policy.reasons });
          continue;
        }
        const candidate = scrubCandidate(raw);
        if (!hasUsableRouting(candidate)) {
          results.push({ slug: candidate.slug, disposition: 'contract_rejected' });
          continue;
        }
        const next = await this.prepare(candidate);
        if ('result' in next) results.push(next.result);
        else prepared.push(next);
      }

      if (prepared.length > 0) {
        let reviewAnswer: string;
        try {
          reviewAnswer = await this.deps.complete(
            { prompt: buildReviewPrompt(window, prepared.map((entry) => entry.envelope)), maxTokens: 2_000 },
            { provider: chat.provider, purpose: 'auto_skill_reviewer' },
          );
        } catch (error) {
          throw new ReviewFailure('reviewer_failure', safeError(error));
        }
        const expected = new Set(prepared.map((entry) => entry.hash));
        const decisions = parseReviewAnswer(reviewAnswer, expected);
        if (decisions === undefined) throw new ReviewFailure('invalid_review', 'The reviewer returned an incomplete or invalid verdict.');
        const byHash = new Map(decisions.map((decision) => [decision.reviewHash, decision]));
        for (const entry of prepared) {
          const decision = byHash.get(entry.hash);
          if (decision?.verdict !== 'APPROVE') {
            results.push({ slug: entry.candidate.slug, disposition: 'review_rejected', reviewReasons: decision?.reasons ?? [] });
            continue;
          }
          const published = this.publish(entry);
          results.push({ ...published.result, reviewReasons: decision.reasons });
          if (published.operationId.length > 0) stagedOperations.push(published.operationId);
        }
      }

      for (const operationId of stagedOperations) this.deps.skills.commitReviewed?.(operationId, now());
      this.advanceTarget(target, lastId);
      finish({ state: 'completed', outcome: 'produced', results, finishedAt: now() });
      journal(`chat=${chat.id} ${results.map(resultLabel).join(' ')}`);
    } catch (error) {
      for (const operationId of stagedOperations) this.deps.skills.abortReviewed?.(operationId);
      const message = safeError(error);
      const code = error instanceof ReviewFailure ? error.code : 'landing_failure';
      finish({ state: 'failed', outcome: 'failed', errorCode: code, errorMessage: message, finishedAt: now() });
      journal(`chat=${chat.id} failed while saving (${message})`);
    }
  }

  /**
   * The oldest conversation with something new in it that has stopped moving --
   * unless somebody asked, and then that one, now.
   *
   * A chat where the user said "vira skill" jumps the queue and skips the idle
   * wait, because those two rules exist to keep the distiller off conversations
   * nobody invited it into, and an explicit request is an invitation. It is
   * matched on the user's own messages in the unread window: the request is
   * already in the text the distiller was going to read, so knowing about it
   * costs no table, no column and no hook on the chat path.
   */
  private pick(chats: readonly Chat[]): Target | undefined {
    const queued = this.deps.marks.nextQueuedAttempt();
    if (queued !== undefined) {
      const chat = chats.find((entry) => entry.id === queued.chatId);
      if (chat === undefined) {
        this.deps.marks.markAttemptRunning(queued.id, new Date(this.deps.clock.now()).toISOString());
        this.deps.marks.finishAttempt(queued.id, {
          state: 'failed',
          outcome: 'failed',
          errorCode: 'chat_gone',
          errorMessage: 'The source conversation no longer exists.',
          finishedAt: new Date(this.deps.clock.now()).toISOString(),
        });
      } else {
        const window = this.deps.chats.getMessageRange(chat.id, {
          ...(queued.fromMessageId === undefined ? {} : { after: queued.fromMessageId }),
          through: queued.throughMessageId,
          limit: WINDOW,
        });
        this.deps.marks.markAttemptRunning(queued.id, new Date(this.deps.clock.now()).toISOString());
        if (window.length === 0 || window[window.length - 1]?.id !== queued.throughMessageId) {
          this.deps.marks.finishAttempt(queued.id, {
            state: 'failed',
            outcome: 'failed',
            errorCode: 'window_gone',
            errorMessage: 'The original conversation window is no longer available.',
            finishedAt: new Date(this.deps.clock.now()).toISOString(),
          });
        } else {
          return {
            chat,
            window,
            ...(queued.fromMessageId === undefined ? {} : { fromMessageId: queued.fromMessageId }),
            requested: queued.requested,
            attemptId: queued.id,
          };
        }
      }
      // A queued retry consumed this tick even when its source disappeared.
      return undefined;
    }

    const idleBefore = this.deps.clock.now() - (this.deps.idleMs ?? DEFAULT_IDLE_MS);
    const ordered = [...chats].sort(
      (left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt),
    );

    // The cheap pass first: one query says which chats have anything the
    // distiller has not seen, and only those get their tail read. A tick in an
    // idle install answers "nobody, nowhere" without opening a single history.
    const lastByChat = new Map(
      this.deps.chats.lastMessageIds().map((entry) => [entry.chatId, entry.lastMessageId]),
    );

    let idle: Target | undefined;
    for (const chat of ordered) {
      const lastId = lastByChat.get(chat.id);
      if (lastId === undefined) continue; // no messages at all
      const mark = this.deps.marks.get(chat.id);
      if (mark !== undefined && mark.messageId === lastId) continue; // nothing new

      const window = this.unreadWindow(chat);
      if (window === undefined) continue;

      const boundary = mark === undefined ? {} : { fromMessageId: mark.messageId };
      if (window.some((message) => message.role === 'user' && asksForSkill(message.content))) {
        return { chat, window, ...boundary, requested: true };
      }
      if (idle === undefined && Date.parse(chat.updatedAt) <= idleBefore) {
        idle = { chat, window, ...boundary, requested: false };
      }
    }
    return idle;
  }

  /** Everything in this chat the distiller has not considered yet. */
  private unreadWindow(chat: Chat): Message[] | undefined {
    const mark = this.deps.marks.get(chat.id);
    const tail = this.deps.chats.getMessages(chat.id, { limit: WINDOW });
    if (tail.length === 0) return undefined;
    if (mark !== undefined && tail[tail.length - 1]!.id === mark.messageId) return undefined;

    // Everything after the mark. A mark that has scrolled out of the window
    // (a very long conversation continued a lot) leaves the whole window,
    // which is the right window to read anyway.
    const seen = mark === undefined ? -1 : tail.findIndex((message) => message.id === mark.messageId);
    const window = tail.slice(seen + 1);
    return window.length === 0 ? undefined : window;
  }

  /** Classifies a baseline-safe candidate before the independent review call. */
  private async prepare(candidate: SkillCandidate): Promise<PreparedCandidate | { result: DistillationResult }> {
    const existing = this.deps.skills.get(candidate.slug);
    const measured = await this.measure(candidate, existing?.slug);
    const target = existing ?? (measured.best === undefined ? undefined : this.deps.skills.get(measured.best.slug));

    if (target !== undefined && target.source !== 'auto') {
      return {
        result: {
          slug: candidate.slug,
          disposition: 'protected_duplicate',
          targetSlug: target.slug,
          reason: existing !== undefined ? 'slug_collision' : 'dedup_match',
          ...(measured.best?.score === undefined && measured.against === undefined
            ? {}
            : { similarity: measured.best?.score ?? measured.against }),
          ...(measured.best?.overlap === undefined && measured.againstOverlap === undefined
            ? {}
            : { overlap: measured.best?.overlap ?? measured.againstOverlap }),
        },
      };
    }

    const action = target === undefined ? 'new' as const : 'revision' as const;
    const finalCandidate = target === undefined ? candidate : { ...candidate, slug: target.slug };
    const neighbour = measured.nearest === undefined
      ? undefined
      : { slug: measured.nearest.slug, similarity: measured.nearest.score, overlap: measured.nearest.overlap };
    const envelope: ReviewEnvelope = {
      candidate: finalCandidate,
      action,
      ...(target === undefined ? {} : { targetSlug: target.slug, targetVersionHash: skillVersionHash(target) }),
      ...(neighbour === undefined ? {} : { neighbour }),
    };
    return { candidate: finalCandidate, envelope, hash: reviewHash(envelope), measured };
  }

  /** Writes only content whose exact review envelope was approved. */
  private publish(entry: PreparedCandidate): { result: DistillationResult; operationId: string } {
    const { candidate, envelope, measured } = entry;
    const policy = runPolicyGate(candidate);
    if (!policy.allowed || reviewHash(envelope) !== entry.hash) {
      throw new ReviewFailure('final_validation_failed', 'The approved candidate changed before publication.');
    }
    const current = envelope.action === 'revision' && envelope.targetSlug !== undefined
      ? this.deps.skills.get(envelope.targetSlug)
      : undefined;
    if (envelope.action === 'revision') {
      if (current === undefined || current.source !== 'auto' || skillVersionHash(current) !== envelope.targetVersionHash) {
        throw new ReviewFailure('revision_changed', 'The Auto-Skill changed after review.');
      }
      // Keep the previous version durably recoverable. This table is no longer an
      // approval inbox; it is the one-level rollback record for automatic rewrites.
      this.deps.revisions.save({
        slug: current.slug,
        name: current.name,
        description: current.description,
        whenToUse: current.whenToUse,
        body: current.body,
        createdAt: new Date(this.deps.clock.now()).toISOString(),
        ...(measured.against === undefined ? {} : { similarity: measured.against }),
      });
    }
    let operationId = '';
    try {
      const input = {
        slug: candidate.slug,
        name: candidate.name,
        description: candidate.description,
        whenToUse: candidate.whenToUse,
        body: candidate.body,
        source: 'auto' as const,
        ...(current?.pinned === true ? { pinned: true } : {}),
      };
      const published = this.deps.skills.publishReviewed?.(input, {
        reviewHash: entry.hash,
        action: envelope.action,
        at: new Date(this.deps.clock.now()).toISOString(),
      });
      if (published === undefined) this.deps.skills.write(input);
      operationId = published?.operationId ?? '';
    } catch (error) {
      if (error instanceof SkillsError) return { result: { slug: candidate.slug, disposition: 'rejected' }, operationId: '' };
      throw error;
    }
    try {
      if (measured.vector !== undefined) {
        this.deps.vectors?.save(candidate.slug, candidateRoutingText(candidate), measured.vector);
      }
    } catch (error) {
      if (operationId.length > 0) this.deps.skills.abortReviewed?.(operationId);
      throw error;
    }
    return { result: {
      slug: candidate.slug,
      disposition: envelope.action === 'new' ? 'published_new' : 'published_revision',
      ...(envelope.targetSlug === undefined ? {} : { targetSlug: envelope.targetSlug }),
      ...(measured.nearest === undefined ? {} : { similarity: measured.nearest.score, overlap: measured.nearest.overlap }),
    }, operationId };
  }

  private async measure(candidate: SkillCandidate, alsoAgainst?: string): Promise<Measured> {
    const embedder = this.deps.embedder;
    if (embedder === undefined) return {};

    const [vector] = await embedder.embed([candidateRoutingText(candidate)], 'passage').catch(() => []);
    if (vector === undefined) return {};

    // `signature` is the stored skill's routing text, which is what the
    // candidate's text has to be compared against -- so the second bar costs
    // no extra read.
    const text = candidateRoutingText(candidate);
    let nearest: Neighbour | undefined;
    let best: Neighbour | undefined;
    let against: number | undefined;
    let againstOverlap: number | undefined;
    for (const entry of this.deps.vectors?.all() ?? []) {
      if (entry.vector.length !== vector.length) continue;
      const score = dot(vector, entry.vector);
      if (entry.slug === alsoAgainst) {
        against = score;
        againstOverlap = vocabularyOverlap(text, entry.signature);
      }
      const neighbour = {
        slug: entry.slug,
        score,
        overlap: vocabularyOverlap(text, entry.signature),
      };
      // The closest thing by cosine is measured whether or not it qualifies,
      // because that number is what a later reading of these logs retunes the
      // bars from -- the same discipline the router's thresholds follow (§8).
      if (nearest === undefined || neighbour.score > nearest.score) nearest = neighbour;
      if (neighbour.score < DEDUP_THRESHOLD) continue;
      if (neighbour.overlap < DEDUP_MIN_OVERLAP) continue;
      if (best === undefined || neighbour.score > best.score) best = neighbour;
    }
    return {
      vector,
      ...(nearest === undefined ? {} : { nearest }),
      ...(best === undefined ? {} : { best }),
      ...(against === undefined ? {} : { against }),
      ...(againstOverlap === undefined ? {} : { againstOverlap }),
    };
  }

  private advanceTarget(target: Target, messageId: string): void {
    if (target.attemptId !== undefined) {
      const current = this.deps.marks.get(target.chat.id);
      // An exact retry may be months old. It may fill a mark that is still at
      // the retry's lower boundary, but it must never rewind a chat whose normal
      // queue has already considered later messages.
      if (current?.messageId !== target.fromMessageId) {
        if (!(current === undefined && target.fromMessageId === undefined)) return;
      }
    }
    this.deps.marks.set(target.chat.id, messageId, new Date(this.deps.clock.now()).toISOString());
  }
}

interface PreparedCandidate {
  candidate: SkillCandidate;
  envelope: ReviewEnvelope;
  hash: string;
  measured: Measured;
}

class ReviewFailure extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ReviewFailure';
  }
}

/** An existing skill, measured against the candidate on both signals. */
interface Neighbour {
  slug: string;
  /** Cosine between the two routing texts. */
  score: number;
  /** Share of content words the two have in common. */
  overlap: number;
}

/** What one dedup pass learned about a candidate. */
interface Measured {
  /** The candidate's routing vector, when there was an embedder to compute it. */
  vector?: Float32Array;
  /** The closest skill by cosine, qualifying or not. Logged, never acted on. */
  nearest?: Neighbour;
  /** The closest skill that cleared BOTH bars: the one to revise, if any. */
  best?: Neighbour;
  /** The cosine against the slug the candidate collided with, when asked. */
  against?: number;
  /** Vocabulary overlap against that same collision target. */
  againstOverlap?: number;
}

/** The vectors are L2-normalized by the embedder, so the dot product is cosine. */
function dot(left: Float32Array, right: Float32Array): number {
  let total = 0;
  for (let index = 0; index < left.length; index += 1) total += left[index]! * right[index]!;
  return total;
}

/**
 * What the taint check reads: **only** what the tools brought back from
 * outside.
 *
 * The message text is deliberately not included, and that is a correction of
 * this file's first version. §10's threat model is INDIRECT injection -- text
 * the agent read from a page, a file, a repository -- and what the user typed
 * is not that. Passing their prose through the same check made the detector's
 * own vocabulary radioactive: measured against this repo's documentation, a
 * bare "system prompt" flags nine benign paragraphs, so every conversation
 * about how Pop Agent works would have been skipped, silently and forever, because
 * the watermark advances on a taint. That is precisely the set of
 * conversations most worth distilling.
 *
 * A user who pastes an injection into the chat themselves is a different
 * story, and not this guard's: they are the principal, and the skill they get
 * is the skill they asked for.
 */
function externalContentOf(message: Message): string {
  return message.tools.map((tool) => tool.detail).join('\n');
}

function resultLabel(result: DistillationResult): string {
  const measured =
    result.similarity === undefined
      ? ''
      : `(cos=${result.similarity.toFixed(2)}${result.overlap === undefined ? '' : `,voc=${result.overlap.toFixed(2)}`})`;
  return `${result.slug}=${result.disposition}${measured}`;
}

/** Provider errors are diagnostics, not a place to persist a response body. */
function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'unknown';
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}
