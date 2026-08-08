import type { Chat, Message } from '../../domain/chat/chat.js';
import { sanitize } from '../../domain/safety/sanitize.js';
import {
  buildDistillPrompt,
  candidateRoutingText,
  parseDistillAnswer,
  scrubCandidate,
  type SkillCandidate,
} from '../../domain/skills/distillation.js';
import { vocabularyOverlap } from '../../domain/skills/skill-router.js';
import { asksForSkill } from '../../domain/skills/skill-request.js';
import type { ChatRepo } from '../ports/chat-repo.js';
import type { Clock } from '../ports/clock.js';
import type { Embedder } from '../ports/embedder.js';
import type { MaintenanceJob } from '../ports/maintenance-job.js';
import type {
  DistillationRepo,
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
 * **A match against an existing skill becomes a revision, not an overwrite.**
 * The proposal waits in its own table while the approved version keeps serving
 * the router (§8). Without that, the pending flag on new skills would guard the
 * front door while the update path stood open.
 */

/** A conversation the distiller has decided to read, and why. */
interface Target {
  chat: Chat;
  window: Message[];
  /** The user asked for a skill here, in so many words. */
  requested: boolean;
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
  /** One completion on the service model of the provider this chat runs on. */
  complete: (
    request: { prompt: string; maxTokens: number },
    context: { provider?: string },
  ) => Promise<string>;
  clock: Clock;
  /** Read per tick, so Settings takes effect on the next one, not the next boot. */
  enabled: () => boolean;
  autoApprove: () => boolean;
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
    const journal = (line: string): void => this.deps.onJournal?.(`pop distiller: ${line}`);

    // Conservative by design: one suspicious tool result anywhere in the window
    // and the whole conversation is skipped, permanently. The alternative --
    // distilling the clean part -- assumes the injection stayed where it was
    // read, and a prompt injection's whole purpose is not to.
    const verdict = sanitize(window.map((message) => externalContentOf(message)).join('\n'));
    if (verdict.riskLevel !== 'low') {
      this.advance(chat.id, lastId);
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
        { provider: chat.provider },
      );
    } catch (error) {
      // The one outcome that does NOT move the mark.
      journal(`chat=${chat.id} failed (${error instanceof Error ? error.message : 'unknown'})`);
      return;
    }

    const { candidates, truncated } = parseDistillAnswer(answer);
    if (candidates.length === 0) {
      // A cut-off answer is not an empty one. The first live run against a real
      // model produced a genuinely useful procedure and lost it here: a
      // reasoning model spent its budget thinking, the JSON stopped mid-field,
      // and "nothing to learn" moved the watermark past a conversation that had
      // plenty. Truncation is treated like a provider failure instead -- the
      // mark stays, and the next tick asks again.
      if (truncated) {
        journal(`chat=${chat.id} answer truncated, nothing salvaged; will retry`);
        return;
      }
      this.advance(chat.id, lastId);
      // Worth its own line: the user asked and got nothing. There is no screen
      // that shows a request the model talked itself out of, so the log is the
      // only place it exists.
      journal(`chat=${chat.id} nothing to learn${requested ? ' (asked for one)' : ''}`);
      return;
    }

    const outcomes: string[] = [];
    for (const candidate of candidates) {
      outcomes.push(await this.land(scrubCandidate(candidate)));
    }
    this.advance(chat.id, lastId);
    journal(`chat=${chat.id} ${outcomes.join(' ')}`);
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
    const idleBefore = this.deps.clock.now() - (this.deps.idleMs ?? DEFAULT_IDLE_MS);
    const ordered = [...chats].sort(
      (left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt),
    );

    let idle: Target | undefined;
    for (const chat of ordered) {
      const window = this.unreadWindow(chat);
      if (window === undefined) continue;

      if (window.some((message) => message.role === 'user' && asksForSkill(message.content))) {
        return { chat, window, requested: true };
      }
      if (idle === undefined && Date.parse(chat.updatedAt) <= idleBefore) {
        idle = { chat, window, requested: false };
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

  /**
   * Where one candidate ends up: a new skill held for approval, a revision of
   * one that already exists, or nothing. The slug is checked before the
   * vectors, because two skills sharing an id is not a similarity question.
   */
  private async land(candidate: SkillCandidate): Promise<string> {
    const existing = this.deps.skills.get(candidate.slug);
    if (existing !== undefined) {
      return this.propose(candidate, existing.slug, 1, `${candidate.slug}=revision(slug)`);
    }

    const measured = await this.measure(candidate);
    // Already filtered on both bars; anything that came back is a match.
    const match = measured.best;
    if (match !== undefined) {
      return this.propose(
        { ...candidate, slug: match.slug },
        match.slug,
        match.score,
        `${match.slug}=revision(${match.score.toFixed(2)})`,
      );
    }

    const live = this.deps.autoApprove();
    try {
      this.deps.skills.write({
        slug: candidate.slug,
        name: candidate.name,
        description: candidate.description,
        whenToUse: candidate.whenToUse,
        body: candidate.body,
        source: 'auto',
        pending: !live,
      });
    } catch (error) {
      if (error instanceof SkillsError) return `${candidate.slug}=rejected`;
      throw error;
    }
    // The vector the dedup just computed is the vector the router would compute
    // -- `candidateRoutingText` and the router's `routingText` are the same
    // string -- so it is stored now rather than on some later message. Waiting
    // is what let a distiller running every ten minutes compare each candidate
    // against a table its own recent work was missing from.
    if (measured.vector !== undefined) {
      this.deps.vectors?.save(candidate.slug, candidateRoutingText(candidate), measured.vector);
    }
    const near =
      measured.nearest === undefined
        ? ''
        : `,near=${measured.nearest.slug}(cos=${measured.nearest.score.toFixed(2)}` +
          `,voc=${measured.nearest.overlap.toFixed(2)})`;
    return `${candidate.slug}=${live ? 'live' : 'pending'}${near}`;
  }

  /**
   * A revision proposal -- or, when the user turned approval off, the edit
   * itself. `source` is passed through explicitly so applying a revision does
   * not read as a human edit: the vault promotes an auto skill to `user` when
   * it is edited, and the distiller rewriting its own work is not that.
   */
  private propose(
    candidate: SkillCandidate,
    slug: string,
    similarity: number,
    label: string,
  ): string {
    const current = this.deps.skills.get(slug);
    if (current === undefined) return `${slug}=gone`;
    // The distiller may rewrite its own work and nothing else. A `builtin`
    // ships with the app; a `user` skill is the user's, or an auto skill they
    // edited, and either way a machine proposing to replace it is proposing to
    // undo a decision a person made. The first real collision was exactly this
    // shape -- a distilled "Restart Pop Agent service" offered as the new text of
    // `self-change` -- and the damage was not the bad similarity score but that
    // a wrong target was reachable at all.
    if (current.source !== 'auto') return `${slug}=${current.source},skipped`;

    if (this.deps.autoApprove()) {
      this.deps.skills.write({
        slug,
        name: candidate.name,
        description: candidate.description,
        whenToUse: candidate.whenToUse,
        body: candidate.body,
        source: current.source,
        ...(current.pinned === true ? { pinned: true } : {}),
        pending: false,
      });
      return `${slug}=updated`;
    }

    this.deps.revisions.save({
      slug,
      name: candidate.name,
      description: candidate.description,
      whenToUse: candidate.whenToUse,
      body: candidate.body,
      createdAt: new Date(this.deps.clock.now()).toISOString(),
      similarity,
    });
    return label;
  }

  /**
   * The candidate's own vector, and the closest existing skill to it. Both come
   * back because the vector is worth keeping whether or not it matched anything:
   * an empty table used to return early, so the first skill of a fresh install
   * was never stored and the second could not be compared to it.
   */
  private async measure(candidate: SkillCandidate): Promise<Measured> {
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
    for (const entry of this.deps.vectors?.all() ?? []) {
      if (entry.vector.length !== vector.length) continue;
      const neighbour = {
        slug: entry.slug,
        score: dot(vector, entry.vector),
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
    };
  }

  private advance(chatId: string, messageId: string): void {
    this.deps.marks.set(chatId, messageId, new Date(this.deps.clock.now()).toISOString());
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
