import { describe, expect, it } from 'vitest';
import { pinnedBodies, selectSkills } from './skill-router.js';
import type { Skill } from './skill.js';

function skill(slug: string, name: string, description: string, whenToUse: string): Skill {
  return { slug, name, description, whenToUse, body: `# ${name}`, source: 'builtin' };
}

const SKILLS: Skill[] = [
  skill('invoices', 'Invoices', 'Create and track invoices', 'when the user talks about billing, invoices or payments'),
  skill('recipes', 'Recipes', 'Cooking and meal planning', 'when the user asks about food, recipes or ingredients'),
  skill('git', 'Git helper', 'Git commands and workflows', 'when the user asks about commits, branches or merges'),
];

/** Vectors in SKILLS order: only `slug` points at the message's [1, 0]. */
function vectorsFavouring(slug: string): (Float32Array | undefined)[] {
  return SKILLS.map((entry) => Float32Array.from(entry.slug === slug ? [1, 0] : [0, 1]));
}

const MESSAGE_VECTOR = Float32Array.from([1, 0]);

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

  it('never selects a pinned skill; it already sits in the system prompt', () => {
    const identity: Skill = {
      ...skill('identity', 'Identity', 'Who you are', 'when the user asks who you are'),
      pinned: true,
    };
    const selected = selectSkills('who are you exactly?', [...SKILLS, identity]);
    expect(selected.map((entry) => entry.skill.slug)).not.toContain('identity');
  });

  it('selects a skill the request shares no words with, on the semantic ranking alone', () => {
    // "make dinner" has no token in common with the recipes skill's metadata.
    const lexicalOnly = selectSkills('make dinner tonight', SKILLS);
    expect(lexicalOnly).toEqual([]);

    const selected = selectSkills('make dinner tonight', SKILLS, {
      messageVector: MESSAGE_VECTOR,
      skillVectors: vectorsFavouring('recipes'),
    });
    expect(selected.map((entry) => entry.skill.slug)).toEqual(['recipes']);
  });

  it('promotes the skill both rankings agree on above the one only words found', () => {
    // "invoices and recipes" scores both skills identically on words; the tie is
    // broken by array order, so invoices leads the lexical ranking.
    const lexicalOnly = selectSkills('invoices and recipes', SKILLS);
    expect(lexicalOnly.map((entry) => entry.skill.slug)).toEqual(['invoices', 'recipes']);

    // Now the vectors agree with recipes. Being in both rankings beats leading one.
    const fused = selectSkills('invoices and recipes', SKILLS, {
      messageVector: MESSAGE_VECTOR,
      skillVectors: vectorsFavouring('recipes'),
    });
    expect(fused.map((entry) => entry.skill.slug)).toEqual(['recipes', 'invoices']);
  });

  it('still selects nothing when neither ranking clears its bar', () => {
    // Vectors present but orthogonal: a weak semantic match is not a match.
    const selected = selectSkills('what is the weather like today?', SKILLS, {
      messageVector: MESSAGE_VECTOR,
      skillVectors: SKILLS.map(() => Float32Array.from([0, 1])),
    });
    expect(selected).toEqual([]);
  });

  it('reports both components, so the bars can be tuned from logs', () => {
    const [top] = selectSkills('invoices and recipes', SKILLS, {
      messageVector: MESSAGE_VECTOR,
      skillVectors: vectorsFavouring('recipes'),
    });
    expect(top?.skill.slug).toBe('recipes');
    expect(top?.lexical).toBeGreaterThan(0);
    expect(top?.similarity).toBeCloseTo(1);
    expect(top?.score).toBeGreaterThan(0);
  });
});

describe('the semantic bar is relative to the request', () => {
  // Six skills sharing no word with the request, so only the semantic ranking
  // can speak. A unit vector at [s, sqrt(1 - s^2)] has cosine exactly `s`
  // against the message's [1, 0], which is how each similarity is dialled in.
  const SIX: Skill[] = Array.from({ length: 6 }, (_, i) =>
    skill(`s${i}`, `S${i}`, `subject ${i}`, `when the topic is ${i}`),
  );
  const vector = (similarity: number): Float32Array =>
    Float32Array.from([similarity, Math.sqrt(1 - similarity * similarity)]);
  const REQUEST = 'zzz qqq';

  it('admits nobody when every skill looks equally plausible', () => {
    // The e5 noise floor: six skills bunched at 0.80, none of them the answer.
    const selected = selectSkills(REQUEST, SIX, {
      messageVector: MESSAGE_VECTOR,
      skillVectors: [0.802, 0.8, 0.799, 0.798, 0.797, 0.796].map(vector),
    });
    expect(selected).toEqual([]);
  });

  it('admits the one skill that stands out from that same pack', () => {
    const selected = selectSkills(REQUEST, SIX, {
      messageVector: MESSAGE_VECTOR,
      skillVectors: [0.86, 0.8, 0.799, 0.798, 0.797, 0.796].map(vector),
    });
    expect(selected.map((entry) => entry.skill.slug)).toEqual(['s0']);
  });

  it('keeps the absolute floor beneath the z test', () => {
    // One skill stands out by a mile, but nothing here is related to anything.
    const selected = selectSkills(REQUEST, SIX, {
      messageVector: MESSAGE_VECTOR,
      skillVectors: [0.4, 0.1, 0.09, 0.08, 0.07, 0.06].map(vector),
    });
    expect(selected).toEqual([]);
  });
});

describe('pinnedBodies', () => {
  it('returns only the pinned bodies, in order', () => {
    const identity: Skill = { ...skill('identity', 'Identity', 'w', 'w'), pinned: true };
    expect(pinnedBodies([...SKILLS, identity])).toEqual(['# Identity']);
  });
});
