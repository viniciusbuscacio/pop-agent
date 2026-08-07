import { describe, expect, it } from 'vitest';
import { SkillsError, type SkillInput, type SkillsRepo } from '../../application/ports/skills-repo.js';
import type { Skill } from '../../domain/skills/skill.js';
import { buildSkillTools } from './skill-tools.js';

/**
 * The "vira skill" hand (popy.spec §8, fase b). What matters here: it writes an
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
    approve: (slug) => skills.get(slug),
    delete: () => true,
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

describe('skill_write', () => {
  it('saves what the conversation taught, as an auto skill', async () => {
    const skills = repo();
    const answer = await call(buildSkillTools(identity as never, skills), 'skill_write', GOOD);

    expect(skills.written).toHaveLength(1);
    expect(skills.written[0]?.source).toBe('auto');
    expect(skills.written[0]?.slug).toBe('deploy-blog');
    expect(answer).toContain('Deploy the blog');
  });

  it('holds the skill for approval by default', async () => {
    const skills = repo();
    const answer = await call(buildSkillTools(identity as never, skills), 'skill_write', GOOD);

    expect(skills.written[0]?.pending).toBe(true);
    // The model must not promise to use something the router will not give it.
    expect(answer).toContain('NOT active yet');
  });

  it('writes it live when the user turned automatic approval on', async () => {
    const skills = repo();
    const answer = await call(
      buildSkillTools(identity as never, skills, () => true),
      'skill_write',
      GOOD,
    );

    expect(skills.written[0]?.pending).toBe(false);
    expect(answer).toContain('it is live');
  });

  it('refuses to overwrite a skill that already works', async () => {
    const existing: Skill = { ...GOOD, source: 'user' };
    const skills = repo([existing]);
    const answer = await call(buildSkillTools(identity as never, skills), 'skill_write', {
      ...GOOD,
      body: 'something else entirely',
    });

    expect(skills.written).toHaveLength(0);
    expect(answer).toContain('already exists');
  });

  it('scrubs a credential out of the body before it can be replayed', async () => {
    const skills = repo();
    await call(buildSkillTools(identity as never, skills), 'skill_write', {
      ...GOOD,
      body: '# Steps\napi_key: sk-live-abcdef123456\n- deploy',
    });

    expect(skills.written[0]?.body).not.toContain('sk-live-abcdef123456');
    expect(skills.written[0]?.body).toContain('[redacted secret]');
  });

  it('hands the vault error back in words the model can act on', async () => {
    const skills = repo();
    const answer = await call(buildSkillTools(identity as never, skills), 'skill_write', {
      ...GOOD,
      slug: 'Not A Slug!',
    });

    expect(answer).toContain('Could not save');
    expect(answer).toContain('lowercase');
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
