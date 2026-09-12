import { describe, expect, it } from 'vitest';
import type { MessageDTO } from '@pop-agent/shared';
import { resendSource } from './resend';

const base = { chatId: 'chat-1', thinking: '', tools: [], attachments: [], createdAt: '' };
const user = { ...base, id: 'user-1', role: 'user' as const, content: 'Please try this' };

describe('resendSource', () => {
  it('returns the user turn before a persisted answer failure', () => {
    const messages: MessageDTO[] = [
      user,
      { ...base, id: 'assistant-1', role: 'assistant', content: 'partial' },
      {
        ...base,
        id: 'failure-1',
        role: 'system',
        content: 'That answer could not be finished. (provider_error)',
      },
    ];

    expect(resendSource(messages, 2)).toEqual(user);
  });

  it('uses structured run-failure metadata without parsing display text', () => {
    const messages: MessageDTO[] = [
      user,
      {
        ...base,
        id: 'failure-1',
        role: 'system',
        content: 'Localized failure text',
        notice: {
          kind: 'run-failure',
          failed: { providerId: 'openai', modelId: 'gpt-5', code: 'network_error' },
        },
      },
    ];

    expect(resendSource(messages, 1)).toEqual(user);
  });

  it('offers the original payload from both the stopped bubble and stop marker', () => {
    const messages: MessageDTO[] = [
      user,
      { ...base, id: 'stopped-1', role: 'system', content: 'You stopped this answer.' },
    ];

    expect(resendSource(messages, 1)).toEqual(user);
    expect(resendSource(messages, 0)).toEqual(user);
  });
});

it('does not retry a completed user turn because a later turn stopped', () => {
 const next = { ...user, id: 'user-2', content: 'next', attachments: [{ name: 'photo.png', type: 'image/png', dataUri: 'data:image/png;base64,YQ==' }] };
 const messages: MessageDTO[] = [user, next, { ...base, id: 'stop', role: 'system', content: 'You stopped this answer.' }];
 expect(resendSource(messages, 0)).toBeUndefined();
 expect(resendSource(messages, 1)).toBe(next);
});
