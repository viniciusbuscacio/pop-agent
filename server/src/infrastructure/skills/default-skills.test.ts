import { describe, expect, it } from 'vitest';
import { selectSkills } from '../../domain/skills/skill-router.js';
import type { Skill } from '../../domain/skills/skill.js';
import { sanitize } from "../../domain/safety/sanitize.js";
import { DEFAULT_SKILLS } from './default-skills.js';

/**
 * The shipped defaults against the real dialogue (2026-07-31) in which the
 * router surfaced no self-knowledge and Pop Agent recommended Python for its own
 * skills (docs/specs/Spec-Pop-General.md §8). The user writes Portuguese, the routing texts are
 * English: these messages must reach pop-agent-codebase on translation-stable
 * tokens alone -- no embedder in the loop.
 */

const SKILLS: Skill[] = DEFAULT_SKILLS.map((skill) => ({ ...skill, source: 'builtin' }));

describe('default skills routing', () => {
  it('routes a Portuguese question about self-programming', () => {
    const selected = selectSkills('Vc saberia se auto-programar?', SKILLS);
    expect(selected[0]?.skill.slug).toBe('pop-agent-codebase');
  });

  it('routes a Portuguese question about a self-development tool', () => {
    const selected = selectSkills(
      'Então seria bom se você tivesse uma ferramenta de auto-desenvolvimento?',
      SKILLS,
    );
    expect(selected[0]?.skill.slug).toBe('pop-agent-codebase');
  });

  it('routes the language question that went wrong in production', () => {
    const selected = selectSkills('Porque não typescript?', SKILLS);
    expect(selected[0]?.skill.slug).toBe('pop-agent-codebase');
  });

  it('routes a Portuguese screenshot request to the web-research skill', () => {
    const selected = selectSkills('Tira um screenshot do site pra mim, navega na internet', SKILLS);
    expect(selected[0]?.skill.slug).toBe('web-research');
  });

  it('has no skill that routes on the word "skill"', () => {
    // The inverse of the test that used to be here. `skill-creator` was routed
    // into nine of sixteen turns of a conversation about baby names, every one
    // of them on the semantic leg alone with `lex=0.00`, and its body told the
    // model to announce what it had decided about writing a skill. Skills left
    // the conversation entirely: the distiller writes them in the background.
    for (const message of ['isso ai foi otimo, vira skill', 'turn this into a skill']) {
      expect(selectSkills(message, SKILLS).map((entry) => entry.skill.slug)).not.toContain(
        'skill-creator',
      );
    }
  });

  it('ships pop-agent-manual pinned: identity is not left to the router', () => {
    expect(DEFAULT_SKILLS.find((skill) => skill.slug === 'pop-agent-manual')?.pinned).toBe(true);
  });

  it('names local retrieval tools for questions about owner data', () => {
    const body = DEFAULT_SKILLS.find((skill) => skill.slug === 'pop-agent-manual')?.body ?? '';
    expect(body).toContain('files_search');
    expect(body).toContain('memory_search');
  });

  it('tells Pop Agent its extensions are TypeScript and routes detailed self-knowledge', () => {
    const body = DEFAULT_SKILLS.find((skill) => skill.slug === 'pop-agent-codebase')?.body ?? '';
    expect(body).toContain('TypeScript on');
    expect(body).toContain('docs/specs/Spec-Pop-General.md');
    expect(body).toContain('Load only the specs relevant to the request');
    expect(body).toContain('inspect current code and');
    expect(body).toContain('## Repo map');
    expect(body).toContain('## UI map');
  });

  it('ships exactly nine built-in skills', () => {
    expect(DEFAULT_SKILLS).toHaveLength(9);
  });
});


describe('on-demand internals reference', () => {
  it('links a real unpinned skill from the pinned manual', () => {
    const manual = DEFAULT_SKILLS.find((skill) => skill.slug === 'pop-agent-manual')!;
    const linked = /skill_read\(\{ slug: "([^"]+)"/.exec(manual.body)?.[1];
    const internals = DEFAULT_SKILLS.find((skill) => skill.slug === linked);
    expect(internals).toBeDefined();
    expect(internals?.pinned).not.toBe(true);
    expect(internals?.body).toContain('## Auto-Skill workflow');
    expect(sanitize(JSON.stringify(internals)).riskLevel).toBe('low');
    expect(manual.body).not.toContain('## Auto-Skill workflow');
  });
});
