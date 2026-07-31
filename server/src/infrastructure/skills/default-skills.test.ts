import { describe, expect, it } from 'vitest';
import { selectSkills } from '../../domain/skills/skill-router.js';
import type { Skill } from '../../domain/skills/skill.js';
import { DEFAULT_SKILLS } from './default-skills.js';

/**
 * The shipped defaults against the real dialogue (2026-07-31) in which the
 * router surfaced no self-knowledge and Popy recommended Python for its own
 * skills (popy.spec §8). The user writes Portuguese, the routing texts are
 * English: these messages must reach self-architecture on translation-stable
 * tokens alone -- no embedder in the loop.
 */

const SKILLS: Skill[] = DEFAULT_SKILLS.map((skill) => ({ ...skill, builtin: true }));

describe('default skills routing', () => {
  it('routes a Portuguese question about self-programming', () => {
    const selected = selectSkills('Vc saberia se auto-programar?', SKILLS);
    expect(selected[0]?.skill.slug).toBe('self-architecture');
  });

  it('routes a Portuguese question about a self-development tool', () => {
    const selected = selectSkills(
      'Então seria bom se você tivesse uma ferramenta de auto-desenvolvimento?',
      SKILLS,
    );
    expect(selected[0]?.skill.slug).toBe('self-architecture');
  });

  it('routes the language question that went wrong in production', () => {
    const selected = selectSkills('Porque não typescript?', SKILLS);
    expect(selected[0]?.skill.slug).toBe('self-architecture');
  });

  it('routes a Portuguese screenshot request to the browser skill', () => {
    const selected = selectSkills('Tira um screenshot do site pra mim, navega na internet', SKILLS);
    expect(selected[0]?.skill.slug).toBe('web-browsing');
  });

  it('ships know-thyself pinned: identity is not left to the router', () => {
    expect(DEFAULT_SKILLS.find((skill) => skill.slug === 'know-thyself')?.pinned).toBe(true);
  });

  it('teaches the files-and-memory-first instinct in know-thyself', () => {
    const body = DEFAULT_SKILLS.find((skill) => skill.slug === 'know-thyself')?.body ?? '';
    expect(body).toContain('files_search');
    expect(body).toContain('memory_search');
  });

  it('tells Popy its extensions are TypeScript', () => {
    const body = DEFAULT_SKILLS.find((skill) => skill.slug === 'self-architecture')?.body ?? '';
    expect(body).toContain('TypeScript on');
    expect(body).toContain('## Repo map');
    expect(body).toContain('## UI map');
  });
});
