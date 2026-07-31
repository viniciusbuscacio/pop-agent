import type { SelectedSkill, Skill } from './skill.js';

/**
 * The Skill Router (popy.spec §8): given what the user asked, pick the handful
 * of skills worth putting in front of the model this turn. Deterministic and
 * lexical -- token overlap between the request and each skill's name,
 * description and `whenToUse`, weighted toward rarer words so "the" counts for
 * nothing and "invoice" counts for a lot. No embeddings, no model: a personal
 * server should not pay a round trip to decide which instructions to read.
 */

export interface RouteOptions {
  /** At most this many skills are selected. */
  topK?: number;
  /** A skill below this score is not relevant enough to include. */
  minScore?: number;
}

const DEFAULT_TOP_K = 3;
const DEFAULT_MIN_SCORE = 1;

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'to', 'of', 'in', 'on', 'for', 'is', 'are', 'be', 'do', 'does',
  'i', 'you', 'it', 'my', 'me', 'we', 'this', 'that', 'with', 'can', 'could', 'would', 'how',
  'what', 'when', 'please', 'help', 'want', 'need', 'use', 'using', 'get', 'make',
  'o', 'a', 'os', 'as', 'de', 'do', 'da', 'e', 'em', 'um', 'uma', 'para', 'por', 'que',
  'com', 'meu', 'minha', 'quero', 'preciso', 'como', 'usar', 'me', 'te',
]);

export function selectSkills(
  message: string,
  skills: readonly Skill[],
  options: RouteOptions = {},
): SelectedSkill[] {
  const query = tokenize(message);
  if (query.size === 0 || skills.length === 0) return [];

  // Inverse document frequency, so a word common to every skill barely counts.
  const df = new Map<string, number>();
  const skillTokens = skills.map((skill) => {
    const tokens = skillTokenSet(skill);
    for (const token of tokens) df.set(token, (df.get(token) ?? 0) + 1);
    return tokens;
  });
  const total = skills.length;

  const scored: SelectedSkill[] = skills.map((skill, index) => {
    let score = 0;
    for (const token of query) {
      if (!(skillTokens[index] as Set<string>).has(token)) continue;
      const seen = df.get(token) ?? total;
      score += Math.log(1 + total / seen);
    }
    return { skill, score };
  });

  const minScore = options.minScore ?? DEFAULT_MIN_SCORE;
  return scored
    .filter((entry) => entry.score >= minScore)
    .sort((left, right) => right.score - left.score)
    .slice(0, options.topK ?? DEFAULT_TOP_K);
}

function skillTokenSet(skill: Skill): Set<string> {
  // The routing signal is the metadata, not the whole body: a skill about
  // invoices should not match every message that says "the".
  return tokenize(`${skill.name} ${skill.name} ${skill.description} ${skill.whenToUse}`);
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
