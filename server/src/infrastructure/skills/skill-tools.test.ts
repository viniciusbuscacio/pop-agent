import { describe, expect, it } from 'vitest';
import { SkillsError, type SkillInput, type SkillsRepo } from '../../application/ports/skills-repo.js';
import type { Skill } from '../../domain/skills/skill.js';
import { buildSkillTools } from './skill-tools.js';

/**
 * The "vira skill" hand (docs/specs/Spec-Pop-General.md §8, fase b). What matters here: it writes an
 * `auto` skill, it will not quietly replace one that already works, and nothing
 * that smells of a credential survives into a body that future prompts replay.
 */

const identity = (tool: never) => tool;

/** An in-memory vault with the one rule this tool depends on: a new slug is new. */
function repo(initial: Skill[] = []): SkillsRepo & { written: SkillInput[] } {
  const skills = new Map(initial.map((skill) => [skill.slug, skill]));
  const written: SkillInput[] = [];
  return {
    written,
    all: () => [...skills.values()],
    get: (slug) => skills.get(slug),
    write: (input) => {
      if (!/^[a-z0-9][a-z0-9-]{0,48}$/.test(input.slug)) {
        throw new SkillsError('A skill id must be lowercase letters, numbers and dashes.');
      }
      written.push(input);
      const skill: Skill = {
        slug: input.slug,
        name: input.name,
        description: input.description,
        whenToUse: input.whenToUse,
        body: input.body,
        source: input.source ?? 'user',
      };
      skills.set(skill.slug, skill);
      return skill;
    },
    delete: () => true,
    setEnabled: () => true,
  };
}

async function call(
  tools: ReturnType<typeof buildSkillTools>,
  name: string,
  params: Record<string, unknown>,
): Promise<string> {
  const tool = tools.find((entry) => entry.name === name);
  if (tool === undefined) throw new Error(`no tool named ${name}`);
  const result = (await tool.execute(
    'call-1',
    params,
    undefined as never,
    undefined as never,
    undefined as never,
  )) as unknown as { content: [{ text: string }] };
  return result.content[0].text;
}

const GOOD = {
  slug: 'deploy-blog',
  name: 'Deploy the blog',
  description: 'How to publish the blog to Cloudflare',
  whenToUse: 'quando o Vinicius pedir para publicar o blog',
  body: '# Steps\n- npm run build\n- wrangler deploy',
};

describe('the agent has no hand to write a skill', () => {
  it('exposes skills_list and nothing else', () => {
    // The tool is gone, not guarded (docs/specs/Spec-Pop-General.md §8, 1.66). Writing a skill mid
    // conversation was the whole of fase (b), and it is what put skill talk in
    // front of the user on turns that had nothing to do with skills. Reading
    // stays: "which skills do you have?" is an ordinary question.
    const names = buildSkillTools(identity as never, repo()).map(
      (tool) => (tool as unknown as { name: string }).name,
    );
    expect(names).toEqual(['skills_list']);
  });
});


describe('skills_list', () => {
  it('shows each skill with where it came from and when it fires', async () => {
    const skills = repo([
      { ...GOOD, source: 'auto' },
      { slug: 'math', name: 'Math', description: 'd', whenToUse: 'numbers', body: 'b', source: 'builtin' },
    ]);
    const answer = await call(buildSkillTools(identity as never, skills), 'skills_list', {});

    expect(answer).toContain('deploy-blog [auto]');
    expect(answer).toContain('math [builtin]');
    expect(answer).toContain('publicar o blog');
  });

  it('says so plainly when there is nothing yet', async () => {
    const answer = await call(buildSkillTools(identity as never, repo()), 'skills_list', {});
    expect(answer).toBe('(no skills yet)');
  });
});
