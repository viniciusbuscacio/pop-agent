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

  it('does not offer resend for a user stop marker', () => {
    const messages: MessageDTO[] = [
      user,
      { ...base, id: 'stopped-1', role: 'system', content: 'You stopped this answer.' },
    ];

    expect(resendSource(messages, 1)).toBeUndefined();
  });
});
