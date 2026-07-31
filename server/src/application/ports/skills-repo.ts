import type { Skill } from '../../domain/skills/skill.js';

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
}

export interface SkillsRepo {
  all(): Skill[];
  get(slug: string): Skill | undefined;
  write(input: SkillInput): Skill;
  delete(slug: string): boolean;
}
