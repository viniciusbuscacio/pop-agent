/**
 * Reciprocal-rank fusion (docs/specs/Spec-Pop-General.md §7): merging the lexical ranking (FTS5) and
 * the semantic ranking (vector similarity) into one, without either needing to
 * know the other's score scale. Each list contributes 1/(k+rank) to a key's
 * total; the keys with the highest sum win. It is the standard, boring,
 * effective way to combine two rankings, and it is pure -- no model here.
 */

const RRF_K = 60;

export interface FusedResult<T> {
  key: string;
  item: T;
  score: number;
}

/**
 * Fuses ranked lists (best first). `keyOf` identifies the same item across
 * lists (a message rowid, a chat id). An item present in several lists is
 * rewarded; the first-seen `item` value is kept for the output.
 */
export function fuseRankings<T>(
  lists: readonly (readonly T[])[],
  keyOf: (item: T) => string,
  options: { k?: number; limit?: number } = {},
): FusedResult<T>[] {
  const k = options.k ?? RRF_K;
  const scores = new Map<string, FusedResult<T>>();

  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = keyOf(item);
      const contribution = 1 / (k + rank + 1);
      const existing = scores.get(key);
      if (existing === undefined) scores.set(key, { key, item, score: contribution });
      else existing.score += contribution;
    });
  }

  const fused = [...scores.values()].sort((left, right) => right.score - left.score);
  return options.limit === undefined ? fused : fused.slice(0, options.limit);
}

/** Cosine similarity of two L2-normalized vectors is just their dot product. */
export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}

/** The indices of the highest-scoring vectors against `query`, best first. */
export function topKByCosine(
  query: Float32Array,
  vectors: { key: string; vector: Float32Array }[],
  limit: number,
): { key: string; score: number }[] {
  return vectors
    .map((entry) => ({ key: entry.key, score: dot(query, entry.vector) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
