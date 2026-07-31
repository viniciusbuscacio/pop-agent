import { describe, expect, it } from 'vitest';
import { selectSkills } from './skill-router.js';
import type { Skill } from './skill.js';

function skill(slug: string, name: string, description: string, whenToUse: string): Skill {
  return { slug, name, description, whenToUse, body: `# ${name}`, builtin: true };
}

const SKILLS: Skill[] = [
  skill('invoices', 'Invoices', 'Create and track invoices', 'when the user talks about billing, invoices or payments'),
  skill('recipes', 'Recipes', 'Cooking and meal planning', 'when the user asks about food, recipes or ingredients'),
  skill('git', 'Git helper', 'Git commands and workflows', 'when the user asks about commits, branches or merges'),
];

describe('selectSkills', () => {
  it('picks the skill whose signal matches the request', () => {
    const selected = selectSkills('can you help me send an invoice to a client?', SKILLS);
    expect(selected[0]?.skill.slug).toBe('invoices');
  });

  it('ranks a clearly relevant skill above the rest', () => {
    const selected = selectSkills('what git branches do I have?', SKILLS);
    expect(selected[0]?.skill.slug).toBe('git');
  });

  it('selects nothing for an unrelated request', () => {
    const selected = selectSkills('what is the weather like today?', SKILLS);
    expect(selected).toEqual([]);
  });

  it('caps the selection at topK', () => {
    const selected = selectSkills('invoice recipe git commit food billing', SKILLS, { topK: 2 });
    expect(selected.length).toBeLessThanOrEqual(2);
  });

  it('is not fooled by common words alone', () => {
    // "the", "a", "to" overlap with everything but must not select anything.
    const selected = selectSkills('please help me with the thing to do', SKILLS);
    expect(selected).toEqual([]);
  });
});
