import { beforeEach, describe, expect, it } from 'vitest';
import type { SkillDTO } from '@pop-agent/shared';
import { matchesSourceFilter, useSkillsStore } from './skills';

function skill(
  slug: string,
  source: SkillDTO['source'],
  pending = false,
): SkillDTO {
  return {
    slug,
    name: slug,
    description: `${slug} description`,
    whenToUse: `when ${slug}`,
    body: `${slug} body`,
    source,
    pending,
  };
}

beforeEach(() => {
  useSkillsStore.setState({ skills: undefined, sourceFilter: 'all' });
});

describe('matchesSourceFilter', () => {
  it('keeps every skill on All Skills', () => {
    expect(matchesSourceFilter(skill('a', 'user'), 'all')).toBe(true);
    expect(matchesSourceFilter(skill('b', 'auto', true), 'all')).toBe(true);
  });

  it('shows only personal skills', () => {
    expect(matchesSourceFilter(skill('mine', 'user'), 'personal')).toBe(true);
    expect(matchesSourceFilter(skill('learned', 'auto'), 'personal')).toBe(false);
  });

  it('shows auto skills that are not pending', () => {
    expect(matchesSourceFilter(skill('learned', 'auto'), 'auto')).toBe(true);
    expect(matchesSourceFilter(skill('waiting', 'auto', true), 'auto')).toBe(false);
  });

  it('shows only pending skills', () => {
    expect(matchesSourceFilter(skill('waiting', 'auto', true), 'pending')).toBe(true);
    expect(matchesSourceFilter(skill('learned', 'auto'), 'pending')).toBe(false);
  });

  it('shows only built-in skills', () => {
    expect(matchesSourceFilter(skill('core', 'builtin'), 'builtin')).toBe(true);
    expect(matchesSourceFilter(skill('mine', 'user'), 'builtin')).toBe(false);
  });
});
