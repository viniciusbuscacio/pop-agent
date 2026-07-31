import { selectSkills } from '../../domain/skills/skill-router.js';
import type { SelectedSkill, Skill } from '../../domain/skills/skill.js';
import type { Embedder } from '../ports/embedder.js';
import type { SkillsRepo } from '../ports/skills-repo.js';

/**
 * The Skill Router with an embedding cache (popy.spec §8). It keeps a vector
 * per skill (of its name + description + whenToUse), so routing costs one
 * embedding of the message rather than one per skill per turn. The vectors are
 * rebuilt only when a skill's routing text changes. Without an embedder it is
 * the pure lexical router.
 */

/** One routed skill as the log sees it: the slug and the score, never the message. */
export interface RoutedSkill {
  slug: string;
  score: number;
}

export class SkillRouterService {
  private readonly cache = new Map<string, { signature: string; vector: Float32Array }>();

  constructor(
    private readonly skills: SkillsRepo,
    private readonly embedder?: Embedder,
    /**
     * Every selection goes here so thresholds are tuned from logged
     * distributions, not guessed (popy.spec §8).
     */
    private readonly onRoute?: (selection: RoutedSkill[]) => void,
  ) {}

  /** The bodies of the skills relevant to this message, best first. */
  async route(message: string): Promise<string[]> {
    // Pinned skills already live in the session's system prompt; only the
    // rest compete for a per-turn slot.
    const skills = this.skills.all().filter((skill) => skill.pinned !== true);
    if (skills.length === 0) return [];

    let selected: SelectedSkill[];
    if (this.embedder === undefined) {
      selected = selectSkills(message, skills);
    } else {
      const skillVectors = await this.skillVectors(skills);
      const [messageVector] = await this.embedder.embed([message], 'query').catch(() => []);
      selected = selectSkills(message, skills, {
        ...(messageVector === undefined ? {} : { messageVector }),
        skillVectors,
      });
    }

    this.onRoute?.(selected.map((entry) => ({ slug: entry.skill.slug, score: entry.score })));
    return selected.map((entry) => entry.skill.body);
  }

  /** A vector per skill, computed once and reused until the skill's text changes. */
  private async skillVectors(skills: Skill[]): Promise<(Float32Array | undefined)[]> {
    const embedder = this.embedder;
    if (embedder === undefined) return skills.map(() => undefined);

    const missing: { index: number; text: string }[] = [];
    const result: (Float32Array | undefined)[] = skills.map((skill, index) => {
      const signature = routingText(skill);
      const cached = this.cache.get(skill.slug);
      if (cached !== undefined && cached.signature === signature) return cached.vector;
      missing.push({ index, text: signature });
      return undefined;
    });

    if (missing.length > 0) {
      const vectors = await embedder.embed(missing.map((entry) => entry.text), 'passage').catch(() => []);
      missing.forEach((entry, i) => {
        const vector = vectors[i];
        if (vector === undefined) return;
        result[entry.index] = vector;
        this.cache.set(skills[entry.index]!.slug, { signature: entry.text, vector });
      });
    }

    return result;
  }
}

function routingText(skill: Skill): string {
  return `${skill.name}. ${skill.description}. ${skill.whenToUse}`;
}
