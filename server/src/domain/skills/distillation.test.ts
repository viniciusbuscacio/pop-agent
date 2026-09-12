import { describe, expect, it } from 'vitest';
import type { Message } from '../chat/chat.js';
import {
  buildDistillPrompt,
  hasUnresolvedRunFailure,
  hasUsableRouting,
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

/** One well-formed skill block, the shape the prompt asks for. */
function block(overrides: Partial<SkillCandidate> = {}): string {
  const skill = candidate(overrides);
  return [
    '=== SKILL ===',
    `slug: ${skill.slug}`,
    `name: ${skill.name}`,
    `description: ${skill.description}`,
    `whenToUse: ${skill.whenToUse}`,
    '--- body ---',
    skill.body,
  ].join('\n');
}

describe('unresolved run failures', () => {
  it('blocks a failed implementation followed only by an empty assistant shell', () => {
    const failed: Message = {
      ...message('system', 'That answer could not be finished. (provider_error)'),
      id: 'failure',
      notice: { kind: 'run-failure', failed: { providerId: 'p', modelId: 'm', code: 'provider_error' } },
    };
    expect(hasUnresolvedRunFailure([
      message('user', 'please implement it'), failed, message('assistant', ''),
    ])).toBe(true);
  });

  it('allows a later completed answer to resolve an earlier interruption', () => {
    expect(hasUnresolvedRunFailure([
      message('assistant', '*— interrupted by a server restart —*'),
      message('user', 'did it work?'),
      message('assistant', 'Yes. The validated operation completed successfully.'),
    ])).toBe(false);
  });
});

describe('buildDistillPrompt', () => {
  it('states the boundary the router depends on: facts are not skills', () => {
    const prompt = buildDistillPrompt([message('user', 'how do I deploy?')], []);
    expect(prompt).toMatch(/PROCEDURAL/);
    expect(prompt).toMatch(/is NOT a skill/);
    expect(prompt).toMatch(/memory/);
  });

  it('offers the empty answer as a normal outcome, not a failure', () => {
    const prompt = buildDistillPrompt([message('user', 'hello')], []);
    expect(prompt).toMatch(/nothing to learn/);
    expect(prompt).toContain('=== END ===');
  });

  it('requires proven success and plausible future reuse by this user', () => {
    const prompt = buildDistillPrompt([message('user', 'hello')], []);
    expect(prompt).toMatch(/Nothing needs escaping/);
    expect(prompt).toContain('A failed/interrupted attempt is never success');
    expect(prompt).toContain('this user has a plausible need to reuse');
    expect(prompt).toContain('product fixes already incorporated into code');
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
  it('reads one skill', () => {
    expect(parseDistillAnswer(`${block()}\n=== END ===`).candidates).toEqual([candidate()]);
  });

  it('reads the block a model wrapped in prose', () => {
    const answer = `Sure, here is what I found:\n\n${block()}\n=== END ===\n\nHope that helps!`;
    expect(parseDistillAnswer(answer).candidates).toEqual([candidate()]);
  });

  it('reads the end marker alone as nothing to learn', () => {
    const parsed = parseDistillAnswer('=== END ===');
    expect(parsed.candidates).toEqual([]);
    expect(parsed.truncated).toBe(false);
  });

  it('keeps several skills from one conversation', () => {
    const answer = [block({ slug: 'one' }), block({ slug: 'two' }), '=== END ==='].join('\n');
    expect(parseDistillAnswer(answer).candidates.map((entry) => entry.slug)).toEqual(['one', 'two']);
  });

  it('keeps the first of two blocks claiming the same id', () => {
    const answer = [
      block({ slug: 'same', name: 'First' }),
      block({ slug: 'same', name: 'Second' }),
      '=== END ===',
    ].join('\n');
    expect(parseDistillAnswer(answer).candidates.map((entry) => entry.name)).toEqual(['First']);
  });

  it('drops a block missing a field instead of inventing one', () => {
    const answer = '=== SKILL ===\nslug: a\nname: A\n--- body ---\nbody\n=== END ===';
    expect(parseDistillAnswer(answer).candidates).toEqual([]);
  });

  it('falls back to the description when whenToUse is missing', () => {
    const answer =
      '=== SKILL ===\nslug: a\nname: A\ndescription: the description\n--- body ---\nbody\n=== END ===';
    expect(parseDistillAnswer(answer).candidates[0]?.whenToUse).toBe('the description');
  });

  /**
   * The case that made this format necessary: a real answer, from a real
   * provider, whose body was a curl command. As JSON it was complete,
   * plausible and invalid -- the unescaped quotes inside `--data` closed the
   * string early and the whole skill was thrown away.
   */
  it('keeps a body full of quotes, braces and backticks', () => {
    const shell =
      "Purge it:\n\n```\ncurl -X POST 'https://api.cloudflare.com/client/v4/zones/{id}/purge_cache' \\\n" +
      '  -H "Authorization: Bearer $CF" --data \'{"purge_all":true}\'\n```\n\nThen check `cf-cache-status`.';
    const answer = `${block({ body: shell })}\n=== END ===`;

    const parsed = parseDistillAnswer(answer);
    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.candidates[0]?.body).toBe(shell);
    expect(parsed.truncated).toBe(false);
  });

  it('does not mistake a body line for a field', () => {
    const answer = `${block({ body: 'name: keep this line in the body' })}\n=== END ===`;
    expect(parseDistillAnswer(answer).candidates[0]?.name).toBe('Deploy the blog');
    expect(parseDistillAnswer(answer).candidates[0]?.body).toBe('name: keep this line in the body');
  });
});

/**
 * The truncation cases, written after a live run lost a real skill to a
 * cut-off answer that the parser read as an empty one.
 */
describe('parseDistillAnswer and answers that were cut off', () => {
  it('keeps the skills that finished when the answer stops mid-sentence', () => {
    const answer = `${block({ slug: 'one' })}\n=== SKILL ===\nslug: two\nname: Tw`;
    const parsed = parseDistillAnswer(answer);

    expect(parsed.candidates.map((entry) => entry.slug)).toEqual(['one']);
    expect(parsed.truncated).toBe(true);
  });

  it('says so when nothing at all survived the cut', () => {
    const parsed = parseDistillAnswer('=== SKILL ===\nslug: one\nname: On');

    expect(parsed.candidates).toEqual([]);
    // The caller keeps the watermark where it is on this, and retries.
    expect(parsed.truncated).toBe(true);
  });

  it('treats an answer with no markers at all as truncated, not as empty', () => {
    // A model that answered in prose never said it was finished, and the
    // conservative reading is that it did not finish.
    const parsed = parseDistillAnswer('I could not find anything reusable.');

    expect(parsed.candidates).toEqual([]);
    expect(parsed.truncated).toBe(true);
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

  it('rejects a candidate whose routing metadata had to be redacted', () => {
    const scrubbed = scrubCandidate(candidate({ whenToUse: 'api_key=actual-looking-value-1234567890' }));
    expect(scrubbed.whenToUse).toBe('[redacted secret]');
    expect(hasUsableRouting(scrubbed)).toBe(false);
    expect(hasUsableRouting(candidate())).toBe(true);
  });

  it('redacts the token shapes that carry no label', () => {
    // A pasted key without "key =" beside it still must not be replayed into
    // future prompts. The shapes recognizable by form alone are the list.
    for (const token of [
      'sk-proj-aBcDeFgHiJkLmNoPqRsT1234',
      'sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789',
      'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456',
      'github_pat_11ABCDEFG0_aBcDeFgHiJkLmNoPqRsTuVwXyZ',
      'glpat-aBcDeFgHiJkLmNoPqRs',
      'AKIAIOSFODNN7EXAMPLE',
    ]) {
      expect(scrubCandidate(candidate({ body: token })).body).toBe('[redacted secret]');
    }
  });

  it('leaves hashes and ids alone -- shape alone is not guilt', () => {
    const body = 'commit 9f8e7d6a5c4b3a2198765432fedcba0987654321 landed, run 8842 passed';
    expect(scrubCandidate(candidate({ body })).body).toBe(body);
  });
});

/**
 * Markers as models actually write them. Every case here cost a live run: the
 * skill was complete and well-formed, and an exact-match parser threw it away
 * over the punctuation of a fence.
 */
describe('parseDistillAnswer and marker sloppiness', () => {
  const fields = [
    'slug: a-skill',
    'name: A skill',
    'description: what it does',
    'whenToUse: when to use it',
  ];

  it('accepts a body fence that lost its closing dashes', () => {
    // Verbatim from a live run against sabiazinho-4.
    const answer = ['=== SKILL ===', ...fields, '--- body', 'The procedure.', '=== END ==='].join('\n');
    expect(parseDistillAnswer(answer).candidates[0]?.body).toBe('The procedure.');
  });

  it('accepts fences of any length, and mixed case', () => {
    const answer = ['==== Skill ====', ...fields, '----body----', 'The procedure.', '== end'].join('\n');
    const parsed = parseDistillAnswer(answer);

    expect(parsed.candidates).toHaveLength(1);
    expect(parsed.truncated).toBe(false);
  });

  it('does not mistake a markdown rule or a heading for a fence', () => {
    // `---` alone and `=== something else ===` must stay body text: a
    // procedure is markdown, and markdown is full of both.
    const body = ['Step one.', '---', '=== not a marker ===', 'Step two.'].join('\n');
    const answer = ['=== SKILL ===', ...fields, '--- body ---', body, '=== END ==='].join('\n');

    expect(parseDistillAnswer(answer).candidates[0]?.body).toBe(body);
  });
});
