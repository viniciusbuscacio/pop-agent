import { describe, expect, it } from 'vitest';
import type { Message } from '../chat/chat.js';
import {
  buildDistillPrompt,
  parseDistillAnswer,
  scrubCandidate,
  slugify,
  type SkillCandidate,
} from './distillation.js';

function message(role: Message['role'], content: string): Message {
  return {
    id: `m-${content.slice(0, 6)}`,
    chatId: 'c1',
    role,
    content,
    thinking: '',
    tools: [],
    attachments: [],
    createdAt: '2026-08-07T18:00:00.000Z',
  };
}

function candidate(overrides: Partial<SkillCandidate> = {}): SkillCandidate {
  return {
    slug: 'deploy-blog',
    name: 'Deploy the blog',
    description: 'How to publish a post',
    whenToUse: 'when the user wants to publish',
    body: 'Push to main.',
    ...overrides,
  };
}

describe('buildDistillPrompt', () => {
  it('states the boundary the router depends on: facts are not skills', () => {
    const prompt = buildDistillPrompt([message('user', 'how do I deploy?')], []);
    expect(prompt).toMatch(/PROCEDURAL/);
    expect(prompt).toMatch(/is NOT a skill/);
    expect(prompt).toMatch(/memory/);
  });

  it('offers the empty answer as a normal outcome, not a failure', () => {
    const prompt = buildDistillPrompt([message('user', 'hello')], []);
    expect(prompt).toMatch(/empty array/);
  });

  it('lists what already exists, so it does not propose a duplicate', () => {
    const prompt = buildDistillPrompt(
      [message('user', 'hello')],
      [{ slug: 'git-rebase', description: 'How to rebase' }],
    );
    expect(prompt).toContain('git-rebase: How to rebase');
  });

  it('drops empty messages instead of showing the model blank turns', () => {
    const prompt = buildDistillPrompt([message('user', 'ask'), message('assistant', '')], []);
    expect(prompt).toContain('user: ask');
    expect(prompt).not.toMatch(/assistant: *$/m);
  });
});

describe('parseDistillAnswer', () => {
  it('reads the array a model wrapped in prose', () => {
    const answer =
      'Sure! Here is what I found:\n```json\n[{"slug":"deploy-blog","name":"Deploy",' +
      '"description":"How to publish","whenToUse":"publishing a post","body":"Push to main."}]\n```';
    expect(parseDistillAnswer(answer)).toEqual([
      {
        slug: 'deploy-blog',
        name: 'Deploy',
        description: 'How to publish',
        whenToUse: 'publishing a post',
        body: 'Push to main.',
      },
    ]);
  });

  it('reads an empty array as nothing to learn', () => {
    expect(parseDistillAnswer('[]')).toEqual([]);
  });

  it('treats an answer with no array at all as nothing to learn', () => {
    expect(parseDistillAnswer('I could not find anything reusable.')).toEqual([]);
  });

  it('treats unparseable JSON as nothing rather than throwing', () => {
    expect(parseDistillAnswer('[{"slug": "broken",]')).toEqual([]);
  });

  it('drops a candidate missing a field instead of inventing one', () => {
    const answer = '[{"slug":"a","name":"A","description":"","body":"x"}]';
    expect(parseDistillAnswer(answer)).toEqual([]);
  });

  it('keeps several skills from one conversation', () => {
    const answer = JSON.stringify([
      { slug: 'one', name: 'One', description: 'd1', whenToUse: 'w1', body: 'b1' },
      { slug: 'two', name: 'Two', description: 'd2', whenToUse: 'w2', body: 'b2' },
    ]);
    expect(parseDistillAnswer(answer).map((entry) => entry.slug)).toEqual(['one', 'two']);
  });

  it('keeps the first of two candidates claiming the same id', () => {
    const answer = JSON.stringify([
      { slug: 'same', name: 'First', description: 'd', whenToUse: 'w', body: 'b' },
      { slug: 'same', name: 'Second', description: 'd', whenToUse: 'w', body: 'b' },
    ]);
    expect(parseDistillAnswer(answer).map((entry) => entry.name)).toEqual(['First']);
  });

  it('falls back to the description when whenToUse is missing', () => {
    const answer = '[{"slug":"a","name":"A","description":"the description","body":"x"}]';
    expect(parseDistillAnswer(answer)[0]?.whenToUse).toBe('the description');
  });
});

describe('slugify', () => {
  it('accepts what the vault would have rejected rather than losing the skill', () => {
    expect(slugify('Deploy the Blog')).toBe('deploy-the-blog');
    expect(slugify('deploy_blog')).toBe('deploy-blog');
    expect(slugify('Configuração do Servidor')).toBe('configuracao-do-servidor');
  });

  it('is empty when there was nothing usable to begin with', () => {
    expect(slugify('!!!')).toBe('');
  });
});

describe('scrubCandidate', () => {
  it('replaces a line carrying a credential, whole', () => {
    const scrubbed = scrubCandidate(
      candidate({ body: 'Run the deploy.\napi_key = sk-live-1234\nDone.' }),
    );
    expect(scrubbed.body).toBe('Run the deploy.\n[redacted secret]\nDone.');
  });

  it('leaves an ordinary procedure alone', () => {
    expect(scrubCandidate(candidate()).body).toBe('Push to main.');
  });
});
