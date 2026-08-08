/**
 * How often each skill is actually injected (pop-agent.spec §8). The router records
 * it; the Skills screen shows it; the garbage collector will one day read it to
 * decide which auto-skills to archive when there are too many.
 *
 * Deliberately a count and a last-used stamp, not a boolean: a skill used twice
 * a year is not the same as a skill never used, and only the pair can tell them
 * apart.
 */

export interface SkillUsage {
  slug: string;
  useCount: number;
  /** ISO-8601, the last time the router put this skill in front of the model. */
  lastUsedAt: string;
}

export interface SkillUsageRepo {
  /** Counts one use of each slug, at the same instant. Unknown slugs start at 1. */
  record(slugs: readonly string[], at: string): void;

  /** Everything recorded, for the Skills screen and the collector. */
  all(): SkillUsage[];
}
