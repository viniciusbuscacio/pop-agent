import { describe, expect, it } from 'vitest';
import { isGenericTitle, nextChatTitle, uniqueTitle } from './title.js';

describe('the starter title', () => {
  it('hands out Chat N with the lowest free N, case-insensitive', () => {
    expect(nextChatTitle([])).toBe('Chat 1');
    expect(nextChatTitle(['Chat 1', 'chat 2', 'Groceries'])).toBe('Chat 3');
    expect(nextChatTitle(['Chat 2'])).toBe('Chat 1');
  });

  it('knows a generic title from a chosen one', () => {
    expect(isGenericTitle('New chat')).toBe(true);
    expect(isGenericTitle('Chat 12')).toBe(true);
    expect(isGenericTitle('Kimi pricing')).toBe(false);
  });

  it('suffixes collisions case-insensitively', () => {
    expect(uniqueTitle('Groceries', ['groceries'])).toBe('Groceries 2');
    expect(uniqueTitle('Groceries', ['GROCERIES', 'groceries 2'])).toBe('Groceries 3');
  });
});
