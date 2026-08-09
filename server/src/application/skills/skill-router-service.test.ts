import { describe, expect, it } from 'vitest';
import type { Skill } from '../../domain/skills/skill.js';
import type { Embedder } from '../ports/embedder.js';
import type { SkillVectorsRepo, StoredSkillVector } from '../ports/skill-vectors-repo.js';
import type { SkillsRepo } from '../ports/skills-repo.js';
import { SkillRouterService, type RoutedSkill } from './skill-router-service.js';

function skill(slug: string, name: string, whenToUse: string): Skill {
  return { slug, name, description: name, whenToUse, body: `body-${slug}`, source: 'builtin' };
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
    approve: (slug) => skills.find((s) => s.slug === slug),
    delete: () => true,
    setEnabled: () => true,
  };
}

/** Maps a phrase to a fixed vector so semantics are controllable. */
class StubEmbedder implements Embedder {
  readonly dimension = 2;
  /** Every batch it was asked to embed, so a test can see what was recomputed. */
  readonly batches: string[][] = [];
  countCalls = (): number => this.batches.length;
  constructor(private readonly map: (text: string) => number[]) {}
  embed(texts: string[]): Promise<Float32Array[]> {
    this.batches.push(texts);
    return Promise.resolve(texts.map((t) => Float32Array.from(this.map(t))));
  }
}

/** An in-memory {@link SkillVectorsRepo}, standing in for the SQLite table. */
class FakeVectors implements SkillVectorsRepo {
  readonly rows = new Map<string, StoredSkillVector>();
  all = (): StoredSkillVector[] => [...this.rows.values()];
  save = (slug: string, signature: string, vector: Float32Array): void => {
    this.rows.set(slug, { slug, signature, vector });
  };
  keepOnly = (slugs: readonly string[]): void => {
    const keep = new Set(slugs);
    for (const slug of [...this.rows.keys()]) if (!keep.has(slug)) this.rows.delete(slug);
  };
}

describe('SkillRouterService', () => {
  it('indexes a pending skill it will not route', async () => {
    // The vector table is also what the distiller dedups against, so indexing
    // and routing answer different questions: everything in the vault gets a
    // vector, and only the routable compete for a slot. Filtering before the
    // index is what let nine copies of one skill into the approval queue.
    const skills = [SKILLS[0]!, { ...SKILLS[1]!, pending: true }];
    const store = new FakeVectors();
    const embedder = new StubEmbedder(() => [1, 0]);
    const service = new SkillRouterService({ skills: repo(skills), embedder, vectors: store });

    const bodies = await service.route('what git branches exist?');

    expect(bodies).not.toContain('body-git');
    expect(store.rows.has('git')).toBe(true);
  });

  it('keeps the stored vector of a pending skill instead of pruning it', async () => {
    // `hydrate` drops the vectors of skills that are gone. A pending skill is
    // not gone, and losing its vector on the next message would undo the fix
    // above on the first turn after a restart.
    const skills = [SKILLS[0]!, { ...SKILLS[1]!, pending: true }];
    const store = new FakeVectors();
    store.save('git', 'Git. Git. when the user asks about commits or branches', Float32Array.from([1, 0]));
    store.save('deleted', 'gone', Float32Array.from([0, 1]));
    const service = new SkillRouterService({
      skills: repo(skills),
      embedder: new StubEmbedder(() => [1, 0]),
      vectors: store,
    });

    await service.route('what git branches exist?');

    expect(store.rows.has('git')).toBe(true);
    expect(store.rows.has('deleted')).toBe(false);
  });

  it('routes lexically without an embedder', async () => {
    const service = new SkillRouterService({ skills: repo(SKILLS) });
    expect(await service.route('what git branches exist?')).toEqual(['body-git']);
  });

  it('routes by meaning when a request shares no words with the skill', async () => {
    // "recipes" skill vector aligns with a cooking query that shares no tokens.
    const embedder = new StubEmbedder((text) =>
      /cook|dinner|food|recipe/.test(text) ? [1, 0] : [0, 1],
    );
    const service = new SkillRouterService({ skills: repo(SKILLS), embedder });

    const bodies = await service.route('make dinner tonight');
    expect(bodies).toContain('body-recipes');
  });

  it('reports every selection so the caller can log it', async () => {
    const seen: RoutedSkill[][] = [];
    const service = new SkillRouterService({
      skills: repo(SKILLS),
      onRoute: (selection) => seen.push(selection),
    });
    await service.route('what git branches exist?');
    expect(seen).toHaveLength(1);
    expect(seen[0]?.map((entry) => entry.slug)).toEqual(['git']);
    expect(seen[0]?.[0]?.score).toBeGreaterThan(0);
    // The lexical component travels with it: the bar is set on that scale.
    expect(seen[0]?.[0]?.lexical).toBeGreaterThan(0);
  });

  it('keeps a pinned skill away from the per-turn selection', async () => {
    const pinned = SKILLS.map((entry) =>
      entry.slug === 'git' ? { ...entry, pinned: true } : entry,
    );
    const service = new SkillRouterService({ skills: repo(pinned) });
    expect(await service.route('what git branches exist?')).toEqual([]);
  });

  it('never routes a skill the user has not accepted', async () => {
    const waiting = SKILLS.map((entry) =>
      entry.slug === 'git' ? { ...entry, pending: true } : entry,
    );
    const service = new SkillRouterService({ skills: repo(waiting) });
    // The lexical match is perfect; the approval is what is missing.
    expect(await service.route('what git branches exist?')).toEqual([]);
  });

  it('counts a use for every skill it puts in front of the model', async () => {
    const recorded: { slugs: string[]; at: string }[] = [];
    const service = new SkillRouterService({
      skills: repo(SKILLS),
      usage: {
        record: (slugs, at) => recorded.push({ slugs: [...slugs], at }),
        all: () => [],
      },
      clock: { now: () => Date.UTC(2026, 7, 7, 18) },
    });

    await service.route('what git branches exist?');
    expect(recorded).toEqual([{ slugs: ['git'], at: '2026-08-07T18:00:00.000Z' }]);
  });

  it('counts nothing for a turn that routed nothing', async () => {
    const recorded: string[][] = [];
    const service = new SkillRouterService({
      skills: repo(SKILLS),
      usage: { record: (slugs) => recorded.push([...slugs]), all: () => [] },
    });

    await service.route('what is the weather like today?');
    expect(recorded).toEqual([]);
  });

  it('caches skill vectors across calls', async () => {
    const embedder = new StubEmbedder(() => [1, 0]);
    const service = new SkillRouterService({ skills: repo(SKILLS), embedder });

    await service.route('first');
    const afterFirst = embedder.countCalls();
    await service.route('second');
    // The second call embeds only the message, not the skills again.
    expect(embedder.countCalls()).toBe(afterFirst + 1);
  });

  it('persists the vectors, so a restart does not re-embed the vault', async () => {
    const vectors = new FakeVectors();
    const first = new SkillRouterService({
      skills: repo(SKILLS),
      embedder: new StubEmbedder(() => [1, 0]),
      vectors,
    });
    await first.route('first');
    expect(vectors.all().map((row) => row.slug).sort()).toEqual(['git', 'recipes']);

    // A new process, same store: only the message is embedded.
    const embedder = new StubEmbedder(() => [1, 0]);
    const restarted = new SkillRouterService({ skills: repo(SKILLS), embedder, vectors });
    await restarted.route('second');
    expect(embedder.countCalls()).toBe(1);
  });

  it('re-embeds only the skill whose routing text changed', async () => {
    const vectors = new FakeVectors();
    await new SkillRouterService({
      skills: repo(SKILLS),
      embedder: new StubEmbedder(() => [1, 0]),
      vectors,
    }).route('first');

    const edited = SKILLS.map((entry) =>
      entry.slug === 'git' ? { ...entry, description: 'Now about tags' } : entry,
    );
    const embedder = new StubEmbedder(() => [1, 0]);
    await new SkillRouterService({ skills: repo(edited), embedder, vectors }).route('second');

    // One passage batch, holding git alone; recipes came off the disk.
    const passages = embedder.batches.filter((batch) =>
      batch.some((text) => text.includes('when the user')),
    );
    expect(passages).toHaveLength(1);
    expect(passages[0]).toHaveLength(1);
    expect(passages[0]?.[0]).toContain('Now about tags');
  });

  it('discards stored vectors from a different embedding model', async () => {
    const vectors = new FakeVectors();
    vectors.save('recipes', 'stale', Float32Array.from([1, 0, 0, 0])); // four dimensions
    vectors.save('gone', 'stale', Float32Array.from([1, 0])); // a skill since deleted

    const embedder = new StubEmbedder(() => [1, 0]); // dimension 2
    await new SkillRouterService({ skills: repo(SKILLS), embedder, vectors }).route('first');

    expect(vectors.rows.has('gone')).toBe(false);
    expect(vectors.rows.get('recipes')?.vector.length).toBe(2);
  });

  it('never routes a skill the user disabled', async () => {
    const disabled = SKILLS.map((entry) =>
      entry.slug === 'git' ? { ...entry, enabled: false as const } : entry,
    );
    const service = new SkillRouterService({ skills: repo(disabled) });
    expect(await service.route('what git branches exist?')).toEqual([]);
  });
});
