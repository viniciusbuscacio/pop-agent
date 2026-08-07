import type { Skill, SkillSource } from '../../domain/skills/skill.js';

/**
 * Persistence for skills (popy.spec §8). The vault on disk is one adapter; the
 * routes and the router see only this. A bad request raises {@link SkillsError}
 * with words the UI can show.
 */
export class SkillsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkillsError';
  }
}

export interface SkillInput {
  slug: string;
  name: string;
  description: string;
  whenToUse: string;
  body: string;
  /** Pin into the session system prompt instead of routing per turn (§8). */
  pinned?: boolean;
  /**
   * Where the skill came from. Absent on an edit means "keep what it already
   * is", except for an auto skill, which the edit promotes to user (§8).
   */
  source?: SkillSource;
  /** Held outside the router until the user accepts it (§8, auto-skill). */
  pending?: boolean;
}

/**
 * Retiring a skill without destroying one (popy.spec §8). Kept apart from
 * {@link SkillsRepo} because it has exactly one caller -- the collector -- and
 * the router, the routes and the agent's tools have no business archiving
 * anything. A vault implements both; a fake in a test that only routes
 * implements neither.
 */
export interface SkillArchiveRepo {
  /** Out of the vault, into `skills/_archive/`. Throws on a built-in. */
  archive(slug: string): boolean;

  /** What is currently retired, so the screen can offer it back. */
  archived(): Skill[];

  /** Back into the vault, in the shape its source implies. */
  restore(slug: string): Skill | undefined;
}

export interface SkillsRepo {
  all(): Skill[];
  get(slug: string): Skill | undefined;
  write(input: SkillInput): Skill;
  /**
   * Accepts a pending skill into the router (popy.spec §8). Separate from
   * `write` because approving is not editing: an edit promotes an auto skill to
   * `user`, and merely saying yes to one must not.
   */
  approve(slug: string): Skill | undefined;
  delete(slug: string): boolean;
}
