import { selectSkills } from '../../domain/skills/skill-router.js';
import type { SelectedSkill, Skill } from '../../domain/skills/skill.js';
import type { Embedder } from '../ports/embedder.js';
import type { Clock } from '../ports/clock.js';
import type { SkillUsageRepo } from '../ports/skill-usage-repo.js';
import type { SkillVectorsRepo } from '../ports/skill-vectors-repo.js';
import type { SkillsRepo, SkillArchiveRepo } from '../ports/skills-repo.js';

/**
 * The Skill Router with its embedding cache (docs/specs/Spec-Pop-General.md §8). It keeps a vector
 * per skill (of its name + description + whenToUse), so routing costs one
 * embedding of the message rather than one per skill per turn.
 *
 * The cache is two-level: a Map for the process, and `vectors` for the disk.
 * Without the repo the vault is re-embedded on the first message after every
 * restart -- correct, but it made the first answer of a session wait on work
 * that had already been done. With it, a vector is computed once and outlives
 * the process; a skill whose routing text changed no longer matches its stored
 * signature, so it -- and only it -- is recomputed.
 */

/** One routed skill as the log sees it: slugs and scores, never the message. */
export interface RoutedSkill {
  slug: string;
  /** The fused rank score that ordered the selection. */
  score: number;
  /** The lexical component, on the IDF scale the `minScore` bar uses. */
  lexical: number;
  /** The cosine component, when this skill had a vector. */
  similarity?: number;
}

export interface SkillRouterDeps {
  skills: SkillsRepo;
  archive?: Pick<SkillArchiveRepo, 'archived'>;
  embedder?: Embedder;
  /** Where vectors survive a restart. Without it the cache is per-process. */
  vectors?: SkillVectorsRepo;
  /**
   * Where a use is counted (docs/specs/Spec-Pop-General.md §8). The router is the only honest place
   * to record it: a skill is "used" when it goes in front of the model, which
   * nothing downstream can observe.
   */
  usage?: SkillUsageRepo;
  clock?: Clock;
  /**
   * Every selection goes here so thresholds are tuned from logged
   * distributions, not guessed (docs/specs/Spec-Pop-General.md §8). Both components are reported,
   * not just the fused score: the bars are set on the components.
   */
  onRoute?: (selection: RoutedSkill[]) => void;
}

export class SkillRouterService {
  private readonly cache = new Map<string, { signature: string; vector: Float32Array }>();
  private hydrated = false;

  constructor(private readonly deps: SkillRouterDeps) {}

  /** The bodies of the skills relevant to this message, best first. */
  async route(message: string): Promise<string[]> {
    // The index covers the whole vault; the filter is applied to the
    // *selection*, not to the indexing. Pinned skills never compete for a
    // per-turn slot because they are already in the session system prompt.
    // The index still covers every active vault entry so dedup sees the same
    // knowledge the router can use.
    const vault = this.deps.skills.all();
    if (vault.length === 0) return [];

    const embedder = this.deps.embedder;
    let selected: SelectedSkill[];
    if (embedder === undefined) {
      selected = selectSkills(message, vault.filter(routable));
    } else {
      const vectors = await this.skillVectors([...vault, ...(this.deps.archive?.archived() ?? [])]);
      const candidates = vault
        .map((skill, index) => ({ skill, vector: vectors[index] }))
        .filter((entry) => routable(entry.skill));
      const [messageVector] = await embedder.embed([message], 'query').catch(() => []);
      selected = selectSkills(message, candidates.map((entry) => entry.skill), {
        ...(messageVector === undefined ? {} : { messageVector }),
        skillVectors: candidates.map((entry) => entry.vector),
      });
    }

    if (selected.length > 0) {
      const at = new Date(this.deps.clock?.now() ?? Date.now()).toISOString();
      this.deps.usage?.record(selected.map((entry) => entry.skill.slug), at);
    }

    this.deps.onRoute?.(
      selected.map((entry) => ({
        slug: entry.skill.slug,
        score: entry.score,
        lexical: entry.lexical,
        ...(entry.similarity === undefined ? {} : { similarity: entry.similarity }),
      })),
    );
    return selected.map((entry) => entry.skill.body);
  }

  /** A vector per skill in the vault, computed once and reused until its text changes. */
  private async skillVectors(skills: Skill[]): Promise<(Float32Array | undefined)[]> {
    const embedder = this.deps.embedder;
    if (embedder === undefined) return skills.map(() => undefined);
    this.hydrate(skills);

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
        const slug = skills[entry.index]!.slug;
        result[entry.index] = vector;
        this.cache.set(slug, { signature: entry.text, vector });
        this.deps.vectors?.save(slug, entry.text, vector);
      });
    }

    return result;
  }

  /**
   * Loads the stored vectors into the process cache, once per process. A vector
   * whose length disagrees with the embedder is dropped rather than compared:
   * the model changed under it, and its numbers no longer mean anything next to
   * the new model's. Same for a vector whose skill is gone -- deleting a skill
   * is a file leaving a folder, so nothing else would ever collect these.
   */
  private hydrate(skills: readonly Skill[]): void {
    if (this.hydrated) return;
    this.hydrated = true;

    const store = this.deps.vectors;
    const embedder = this.deps.embedder;
    if (store === undefined || embedder === undefined) return;

    const live = new Set(skills.map((skill) => skill.slug));
    let dropped = false;
    for (const stored of store.all()) {
      if (!live.has(stored.slug) || stored.vector.length !== embedder.dimension) {
        dropped = true;
        continue;
      }
      this.cache.set(stored.slug, { signature: stored.signature, vector: stored.vector });
    }
    if (dropped) store.keepOnly([...this.cache.keys()]);
  }
}

/**
 * Whether a skill may take one of this turn's slots. Not whether it is indexed:
 * everything in the vault is indexed, because the vector table is also what the
 * distiller dedups against.
 */
function routable(skill: Skill): boolean {
  return skill.pinned !== true && skill.enabled !== false;
}

function routingText(skill: Skill): string {
  return `${skill.name}. ${skill.description}. ${skill.whenToUse}`;
}
