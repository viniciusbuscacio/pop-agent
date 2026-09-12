import { beforeEach, describe, expect, it } from 'vitest';
import type { SkillDTO } from '@pop-agent/shared';
import { matchesSourceFilter, skillEnabled, useSkillsStore } from './skills';

function skill(
  slug: string,
  source: SkillDTO['source'],
): SkillDTO {
  return {
    slug,
    name: slug,
    description: `${slug} description`,
    whenToUse: `when ${slug}`,
    body: `${slug} body`,
    source,
  };
}

beforeEach(() => {
  useSkillsStore.setState({ skills: undefined, sourceFilter: 'all' });
});

describe('matchesSourceFilter', () => {
  it('keeps every skill on All Skills', () => {
    expect(matchesSourceFilter(skill('a', 'user'), 'all')).toBe(true);
    expect(matchesSourceFilter(skill('b', 'auto'), 'all')).toBe(true);
  });

  it('shows only personal skills', () => {
    expect(matchesSourceFilter(skill('mine', 'user'), 'personal')).toBe(true);
    expect(matchesSourceFilter(skill('learned', 'auto'), 'personal')).toBe(false);
  });

  it('shows Auto-Skills', () => {
    expect(matchesSourceFilter(skill('learned', 'auto'), 'auto')).toBe(true);
    expect(matchesSourceFilter(skill('mine', 'user'), 'auto')).toBe(false);
  });

  it('shows only built-in skills', () => {
    expect(matchesSourceFilter(skill('core', 'builtin'), 'builtin')).toBe(true);
    expect(matchesSourceFilter(skill('mine', 'user'), 'builtin')).toBe(false);
  });
});

describe('skillEnabled', () => {
  it('treats absent enabled as on', () => {
    expect(skillEnabled(skill('a', 'user'))).toBe(true);
  });

  it('respects an explicit false', () => {
    expect(skillEnabled({ ...skill('a', 'user'), enabled: false } as SkillDTO & { enabled: boolean })).toBe(
      false,
    );
  });
});
