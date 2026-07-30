import { describe, expect, it } from 'vitest';
import { newChatId, newMessageId, newRunId } from './ids.js';

describe('identifiers', () => {
  it('carry a readable prefix and the documented width', () => {
    expect(newChatId()).toMatch(/^chat-[0-9a-f]{12}$/);
    expect(newMessageId()).toMatch(/^msg-[0-9a-f]{16}$/);
    expect(newRunId()).toMatch(/^run-[0-9a-f]{16}$/);
  });

  it('do not repeat', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newChatId()));

    expect(ids.size).toBe(5000);
  });

  it('say nothing about how many exist or when they were made', () => {
    // A counter or a timestamp would make consecutive ids share a prefix.
    const first = newChatId().slice(5);
    const second = newChatId().slice(5);

    expect(first.slice(0, 4)).not.toBe(second.slice(0, 4));
  });
});
