/**
 * A skill: a named piece of know-how the agent pulls in when it is relevant
 * (docs/specs/Spec-Pop-General.md §8, the Skill Router). Description and `whenToUse` are the routing
 * signal -- matched against what the user asked -- and `body` is the markdown
 * that joins the prompt when the skill is selected.
 */

/**
 * Where a skill came from (docs/specs/Spec-Pop-General.md §8, auto-skill). `builtin` ships with the
 * app and updates with it; `auto` was distilled from a conversation and is the
 * garbage collector's to archive; `user` is the user's own and is never touched
 * automatically. Editing an auto skill promotes it to `user`: it proved its
 * worth, so the collector stops looking at it.
 */
export type SkillSource = 'builtin' | 'auto' | 'user';

export interface Skill {
  /** Stable slug, and the file name without extension. */
  slug: string;
  name: string;
  description: string;
  /** When this skill should fire, in the author's words. Routed on. */
  whenToUse: string;
  body: string;
  /** Where it came from, and therefore what may happen to it. */
  source: SkillSource;
  /**
   * A pinned skill bypasses the router: its body joins the session's system
   * prompt once instead of competing for a per-turn slot (docs/specs/Spec-Pop-General.md §8).
   * Identity is a prerequisite of every answer, not a situational skill.
   */
  pinned?: boolean;
  /**
   * A disabled skill stays in the vault but is excluded from routing and from
   * the pinned set that reaches the session prompt (docs/specs/Spec-Pop-General.md §8). Absent
   * means enabled -- no frontmatter noise for the default case.
   */
  enabled?: boolean;
}

/** A skill the router picked, with why. */
export interface SelectedSkill {
  skill: Skill;
  /** The fused rank score (RRF): what ordered the selection. */
  score: number;
  /**
   * The two components behind the fusion, kept because the bars that decide
   * who is a candidate at all are set on these scales, not on the fused one.
   * `similarity` is absent when the skill had no vector.
   */
  lexical: number;
  similarity?: number;
}
