import { describe, expect, it } from 'vitest';
import type { Skill } from '../../domain/skills/skill.js';
import type { Embedder } from '../ports/embedder.js';
import type { SkillsRepo } from '../ports/skills-repo.js';
import { SkillRouterService, type RoutedSkill } from './skill-router-service.js';

function skill(slug: string, name: string, whenToUse: string): Skill {
  return { slug, name, description: name, whenToUse, body: `body-${slug}`, builtin: true };
}

const SKILLS: Skill[] = [
  skill('recipes', 'Recipes', 'when the user asks about food or cooking'),
  skill('git', 'Git', 'when the user asks about commits or branches'),
];

function repo(skills: Skill[]): SkillsRepo {
  return {
    all: () => skills,
    get: (slug) => skills.find((s) => s.slug === slug),
    write: () => skills[0]!,
    delete: () => true,
  };
}

/** Maps a phrase to a fixed vector so semantics are controllable. */
class StubEmbedder implements Embedder {
  readonly dimension = 2;
  private calls = 0;
  countCalls = () => this.calls;
  constructor(private readonly map: (text: string) => number[]) {}
  embed(texts: string[]): Promise<Float32Array[]> {
    this.calls += 1;
    return Promise.resolve(texts.map((t) => Float32Array.from(this.map(t))));
  }
}

describe('SkillRouterService', () => {
  it('routes lexically without an embedder', async () => {
    const service = new SkillRouterService(repo(SKILLS));
    expect(await service.route('what git branches exist?')).toEqual(['body-git']);
  });

  it('routes by meaning when a request shares no words with the skill', async () => {
    // "recipes" skill vector aligns with a cooking query that shares no tokens.
    const embedder = new StubEmbedder((text) =>
      /cook|dinner|food|recipe/.test(text) ? [1, 0] : [0, 1],
    );
    const service = new SkillRouterService(repo(SKILLS), embedder);

    const bodies = await service.route('help me make dinner tonight');
    expect(bodies).toContain('body-recipes');
  });

  it('reports every selection so the caller can log it', async () => {
    const seen: RoutedSkill[][] = [];
    const service = new SkillRouterService(repo(SKILLS), undefined, (selection) =>
      seen.push(selection),
    );
    await service.route('what git branches exist?');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.map((entry) => entry.slug)).toEqual(['git']);
    expect(seen[0]?.[0]?.score).toBeGreaterThan(0);
  });

  it('keeps a pinned skill away from the per-turn selection', async () => {
    const pinned = SKILLS.map((entry) =>
      entry.slug === 'git' ? { ...entry, pinned: true } : entry,
    );
    const service = new SkillRouterService(repo(pinned));
    expect(await service.route('what git branches exist?')).toEqual([]);
  });

  it('caches skill vectors across calls', async () => {
    const embedder = new StubEmbedder(() => [1, 0]);
    const service = new SkillRouterService(repo(SKILLS), embedder);

    await service.route('first');
    const afterFirst = embedder.countCalls();
    await service.route('second');
    // The second call embeds only the message, not the skills again.
    expect(embedder.countCalls()).toBe(afterFirst + 1);
  });
});
