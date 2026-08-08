import { dot, fuseRankings } from '../memory/rank-fusion.js';
import type { SelectedSkill, Skill } from './skill.js';

/**
 * The Skill Router (pop-agent.spec §8): given what the user asked, pick the handful
 * of skills worth putting in front of the model this turn.
 *
 * Two rankings, fused. The lexical one is token overlap between the request and
 * each skill's name, description and `whenToUse`, weighted toward rarer words
 * so "the" counts for nothing and "invoice" counts for a lot. The semantic one
 * is cosine over the embeddings, and it is what reaches a "recipes" skill from
 * "help me make dinner" -- a request that shares no word with it. Neither
 * ranking has to know the other's score scale, because they are merged with the
 * same reciprocal-rank fusion the memory search uses (pop-agent.spec §7). That
 * replaces the hand-tuned blend this router used to carry, where a cosine was
 * turned into lexical points by a constant nobody could justify.
 *
 * A skill enters a ranking only by clearing that ranking's bar. That is what
 * keeps an unrelated request selecting nothing at all -- RRF orders candidates,
 * it does not create them. Either signal alone is enough to qualify a skill; a
 * skill both agree on rises above one only a single ranking found, which is the
 * whole point of fusing them.
 *
 * Without vectors it is the pure lexical router, and still deterministic: a
 * personal server should not pay a round trip to decide which instructions to
 * read. But it is worth knowing what that costs here, because "why not just
 * match words?" is the obvious question: the skills ship with English metadata
 * and Vinicius writes to Pop Agent in Portuguese, so the two share almost no tokens
 * at all. Over ten labelled requests the lexical half alone found two, and both
 * were requests where the right answer was "nothing"; its single real hit was
 * `web-browsing` on "procura na internet", and only because "internet" happens
 * to be spelled the same in both languages. The fused router found seven.
 *
 * That is what the semantic half is buying, and no better lexical engine --
 * FTS5, bm25, a real stemmer -- would buy it instead: they all rank word
 * matches, and there are no word matches to rank across languages. The lever
 * that would change this answer is writing the skills' `whenToUse` in the
 * language the user actually types.
 */

export interface RouteOptions {
  /** At most this many skills are selected. */
  topK?: number;
  /** The lexical bar: below this IDF overlap a skill does not enter the ranking. */
  minScore?: number;
  /** The semantic floor: a sanity check, not the gate. See {@link minZ}. */
  minSimilarity?: number;
  /** The semantic gate: standard deviations above this request's own mean. */
  minZ?: number;
  /**
   * Optional embeddings (pop-agent.spec §8): the message's vector and each skill's,
   * in the same order as `skills`. When present, the semantic ranking joins the
   * fusion; when absent, routing is lexical and nothing else changes.
   */
  messageVector?: Float32Array;
  skillVectors?: (Float32Array | undefined)[];
}

const DEFAULT_TOP_K = 3;
const DEFAULT_MIN_SCORE = 1;

/**
 * The semantic bars, measured against the real vault (24 skills, e5) rather
 * than guessed -- which is what pop-agent.spec §8 asks for.
 *
 * e5 compresses everything into a narrow band: over 192 query/skill pairs the
 * cosines ran 0.70 to 0.84, with the 90th percentile at 0.80. An absolute
 * threshold cannot work in that band, and the one this router used to carry
 * proved it: "help me make dinner" -- with no cooking skill in the vault at all
 * -- returned daily-review, shell-safety and math, every one of them at 0.79 to
 * 0.80. Meanwhile `math` scored 0.745 on "the square root of 1444", *below* that
 * noise. There is no line to draw.
 *
 * What does separate is how far a skill stands out from the pack for this
 * particular request. Over ten labelled requests, the skill a human would pick
 * scored z = 0.9 to 2.9 (median 2.5), while the best noise hit on a request no
 * skill answers reached only z = 1.9 to 2.1. A bar at 2.1 admitted five of the
 * eight real matches and neither of the two noise hits -- precision first,
 * because the lexical ranking is already there to catch the rest, and a wrong
 * skill costs one of three slots on every turn.
 *
 * MIN_SIMILARITY stays as a floor beneath the z test: it catches the degenerate
 * case where every skill is unrelated and one of them is merely least unrelated.
 */
const DEFAULT_MIN_SIMILARITY = 0.75;
const DEFAULT_MIN_Z = 2.1;
/** Below this many measured skills the spread is too thin to read a z from. */
const MIN_CANDIDATES_FOR_Z = 5;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'to', 'of', 'in', 'on', 'for', 'is', 'are', 'be', 'do', 'does',
  'i', 'you', 'it', 'my', 'me', 'we', 'this', 'that', 'with', 'can', 'could', 'would', 'how',
  'what', 'when', 'please', 'help', 'want', 'need', 'use', 'using', 'get', 'make',
  'o', 'a', 'os', 'as', 'de', 'do', 'da', 'e', 'em', 'um', 'uma', 'para', 'por', 'que',
  'com', 'meu', 'minha', 'quero', 'preciso', 'como', 'usar', 'me', 'te',
]);

/** A skill with both signals measured, before either bar is applied. */
interface Candidate {
  skill: Skill;
  lexical: number;
  /** Absent when there was no vector for the message or for this skill. */
  similarity?: number;
}

/**
 * The bodies of the pinned skills, in vault order. They skip routing entirely:
 * the bridge puts them in the session's system prompt (pop-agent.spec §8).
 */
export function pinnedBodies(skills: readonly Skill[]): string[] {
  return skills.filter((skill) => skill.pinned === true).map((skill) => skill.body);
}

export function selectSkills(
  message: string,
  skills: readonly Skill[],
  options: RouteOptions = {},
): SelectedSkill[] {
  if (skills.length === 0) return [];

  // Pinned skills are already in the system prompt; selecting one would put it
  // in front of the model twice. Vectors are paired first so the caller's
  // index alignment survives the filter.
  const candidates = skills
    .map((skill, index) => ({ skill, vector: options.skillVectors?.[index] }))
    .filter((candidate) => candidate.skill.pinned !== true);
  if (candidates.length === 0) return [];

  const scored = measure(tokenize(message), candidates, options.messageVector);

  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  const lexical = scored
    .filter((candidate) => candidate.lexical >= minScore)
    .sort((left, right) => right.lexical - left.lexical);
  const semantic = semanticRanking(
    scored,
    options.minSimilarity ?? DEFAULT_MIN_SIMILARITY,
    options.minZ ?? DEFAULT_MIN_Z,
  );

  return fuseRankings([lexical, semantic], (candidate) => candidate.skill.slug, {
    limit: options.topK ?? DEFAULT_TOP_K,
  }).map((fused) => ({
    skill: fused.item.skill,
    score: fused.score,
    lexical: fused.item.lexical,
    ...(fused.item.similarity === undefined ? {} : { similarity: fused.item.similarity }),
  }));
}

/** Both signals for every candidate: IDF-weighted overlap, and cosine if we can. */
function measure(
  query: Set<string>,
  candidates: { skill: Skill; vector: Float32Array | undefined }[],
  messageVector: Float32Array | undefined,
): Candidate[] {
  // Inverse document frequency, so a word common to every skill barely counts.
  const df = new Map<string, number>();
  const skillTokens = candidates.map(({ skill }) => {
    const tokens = skillTokenSet(skill);
    for (const token of tokens) df.set(token, (df.get(token) ?? 0) + 1);
    return tokens;
  });
  const total = candidates.length;

  return candidates.map(({ skill, vector }, index) => {
    let lexical = 0;
    for (const token of query) {
      if (!(skillTokens[index] as Set<string>).has(token)) continue;
      const seen = df.get(token) ?? total;
      lexical += Math.log(1 + total / seen);
    }
    // The vectors are L2-normalized, so the dot product is the cosine.
    const similarity =
      messageVector === undefined || vector === undefined
        ? undefined
        : dot(messageVector, vector);
    return { skill, lexical, ...(similarity === undefined ? {} : { similarity }) };
  });
}

/**
 * The skills that stand out semantically for this request, best first. The bar
 * is relative -- see {@link DEFAULT_MIN_Z} -- so it is read from the spread of
 * this request's own similarities, and a vault whose skills all look equally
 * plausible contributes nobody rather than its luckiest member.
 */
function semanticRanking(scored: Candidate[], floor: number, minZ: number): Candidate[] {
  const measured = scored.filter(
    (candidate): candidate is Candidate & { similarity: number } =>
      candidate.similarity !== undefined,
  );
  if (measured.length === 0) return [];

  let admitted = measured.filter((candidate) => candidate.similarity >= floor);
  if (measured.length >= MIN_CANDIDATES_FOR_Z) {
    const mean = measured.reduce((sum, c) => sum + c.similarity, 0) / measured.length;
    const variance =
      measured.reduce((sum, c) => sum + (c.similarity - mean) ** 2, 0) / measured.length;
    const deviation = Math.sqrt(variance);
    admitted =
      deviation === 0
        ? []
        : admitted.filter((candidate) => (candidate.similarity - mean) / deviation >= minZ);
  }

  return admitted.sort((left, right) => right.similarity - left.similarity);
}

function skillTokenSet(skill: Skill): Set<string> {
  // The routing signal is the metadata, not the whole body: a skill about
  // invoices should not match every message that says "the".
  return tokenize(`${skill.name} ${skill.name} ${skill.description} ${skill.whenToUse}`);
}

/**
 * How much vocabulary two routing texts share, as Jaccard over content words.
 * The distiller's dedup reads this; the router does not, because a message and
 * a skill are not the same kind of text and overlap between them is one-sided.
 *
 * It exists because cosine alone cannot answer "is this the same skill". Over
 * the real vault (378 pairs of distinct skills, 36 pairs of known duplicates)
 * the two cosine distributions overlap between 0.895 and 0.936: `brainstorm`
 * and `planning` score 0.936 while two re-distillations of one procedure score
 * 0.895. Vocabulary does separate them -- distinct skills top out at 0.18
 * shared, duplicates sit at 0.33 median -- because two skills in one domain
 * share the domain, and two copies of one skill share the thing itself.
 */
export function vocabularyOverlap(left: string, right: string): number {
  const a = tokenize(left);
  const b = tokenize(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

function tokenize(text: string): Set<string> {
  const tokens = text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
  return new Set(tokens.filter((token) => !STOP_WORDS.has(token)).map(stem));
}

/**
 * The crudest stemming that pays for itself: fold a trailing plural 's' so
 * "invoice" and "invoices", "commit" and "commits" route the same. Words of
 * three letters or fewer are left alone (so "is" would not become "i").
 */
function stem(token: string): string {
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) {
    return token.slice(0, -1);
  }
  return token;
}
