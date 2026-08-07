/**
 * Storage for the skill router's vectors (popy.spec §8). One row per skill,
 * stamped with the routing text it was computed from, so a skill whose
 * description changed is re-embedded and one that did not is free -- across
 * restarts, which an in-process cache cannot manage.
 *
 * The vault is the source of truth for which skills exist; this is only a
 * cache in front of the embedder, and every method is safe to lose.
 */

export interface StoredSkillVector {
  slug: string;
  /** The exact text that was embedded; a mismatch is what invalidates the vector. */
  signature: string;
  vector: Float32Array;
}

export interface SkillVectorsRepo {
  /** Every stored vector, for the router to load into memory once. */
  all(): StoredSkillVector[];

  /** Saves (or replaces) a skill's vector and the text it came from. */
  save(slug: string, signature: string, vector: Float32Array): void;

  /** Drops every vector whose slug is not in the list -- deleted skills. */
  keepOnly(slugs: readonly string[]): void;
}
