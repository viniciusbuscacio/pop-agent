import { describe, expect, it } from 'vitest';
import type { Skill } from '../../domain/skills/skill.js';
import type { SkillUsage, SkillUsageRepo } from '../ports/skill-usage-repo.js';
import { SkillsError, type SkillArchiveRepo, type SkillsRepo } from '../ports/skills-repo.js';
import { SkillCollector } from './skill-collector.js';

function skill(slug: string, source: Skill['source'] = 'auto', pending = false): Skill {
  return {
    slug,
    name: slug,
    description: slug,
    whenToUse: slug,
    body: slug,
    source,
    ...(pending ? { pending: true } : {}),
  };
}

function repo(skills: Skill[]): SkillsRepo {
  return {
    all: () => skills,
    get: (slug) => skills.find((entry) => entry.slug === slug),
    write: () => skills[0]!,
    approve: (slug) => skills.find((entry) => entry.slug === slug),
    delete: () => true,
    setEnabled: () => true,
  };
}

function usageRepo(entries: Record<string, { useCount: number; lastUsedAt: string }>): SkillUsageRepo {
  return {
    record: () => undefined,
    all: (): SkillUsage[] =>
      Object.entries(entries).map(([slug, value]) => ({ slug, ...value })),
  };
}

function archiveRepo(options: { refuse?: string[] } = {}): SkillArchiveRepo & { archived: string[] } {
  const archived: string[] = [];
  return {
    archived,
    archive: (slug: string) => {
      if (options.refuse?.includes(slug) === true) throw new SkillsError('nope');
      archived.push(slug);
      return true;
    },
    restore: () => undefined,
  } as unknown as SkillArchiveRepo & { archived: string[] };
}

describe('SkillCollector', () => {
  it('does nothing while the vault is under the cap', () => {
    const archive = archiveRepo();
    new SkillCollector({ skills: repo([skill('a'), skill('b')]), archive, cap: 2 }).run();

    expect(archive.archived).toEqual([]);
  });

  it('retires the least used first, down to the cap', () => {
    const archive = archiveRepo();
    new SkillCollector({
      skills: repo([skill('busy'), skill('quiet'), skill('idle')]),
      archive,
      usage: usageRepo({
        busy: { useCount: 10, lastUsedAt: '2026-08-01T00:00:00.000Z' },
        quiet: { useCount: 2, lastUsedAt: '2026-08-01T00:00:00.000Z' },
        idle: { useCount: 0, lastUsedAt: '2026-08-01T00:00:00.000Z' },
      }),
      cap: 1,
    }).run();

    expect(archive.archived).toEqual(['idle', 'quiet']);
  });

  it('breaks a tie on which was used longest ago', () => {
    const archive = archiveRepo();
    new SkillCollector({
      skills: repo([skill('recent'), skill('stale')]),
      archive,
      usage: usageRepo({
        recent: { useCount: 1, lastUsedAt: '2026-08-07T00:00:00.000Z' },
        stale: { useCount: 1, lastUsedAt: '2026-01-01T00:00:00.000Z' },
      }),
      cap: 1,
    }).run();

    expect(archive.archived).toEqual(['stale']);
  });

  it('keeps a seasonal skill that was used, over one that never was', () => {
    // The case a "90 days idle" rule would get exactly backwards: the annual
    // tax procedure has been used, the never-routed one has not.
    const archive = archiveRepo();
    new SkillCollector({
      skills: repo([skill('irpf'), skill('never')]),
      archive,
      usage: usageRepo({ irpf: { useCount: 3, lastUsedAt: '2026-03-01T00:00:00.000Z' } }),
      cap: 1,
    }).run();

    expect(archive.archived).toEqual(['never']);
  });

  it('never touches a user skill or a built-in', () => {
    const archive = archiveRepo();
    new SkillCollector({
      skills: repo([skill('mine', 'user'), skill('shipped', 'builtin'), skill('auto1')]),
      archive,
      cap: 0,
    }).run();

    expect(archive.archived).toEqual(['auto1']);
  });

  it('leaves the approval queue alone', () => {
    // A pending skill has had no chance to be used, so by use count it always
    // looks like the worst skill in the vault.
    const archive = archiveRepo();
    new SkillCollector({
      skills: repo([skill('waiting', 'auto', true), skill('live')]),
      archive,
      cap: 1,
    }).run();

    expect(archive.archived).toEqual([]);
  });

  it('carries on when one skill will not move', () => {
    const archive = archiveRepo({ refuse: ['stuck'] });
    const journal: string[] = [];
    new SkillCollector({
      skills: repo([skill('stuck'), skill('movable'), skill('keep')]),
      archive,
      usage: usageRepo({
        stuck: { useCount: 0, lastUsedAt: '2026-01-01T00:00:00.000Z' },
        movable: { useCount: 1, lastUsedAt: '2026-01-01T00:00:00.000Z' },
        keep: { useCount: 9, lastUsedAt: '2026-01-01T00:00:00.000Z' },
      }),
      cap: 1,
      onJournal: (line) => journal.push(line),
    }).run();

    expect(archive.archived).toEqual(['movable']);
    expect(journal.join(' ')).toMatch(/stuck could not be archived/);
  });
});
