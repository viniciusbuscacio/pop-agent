import { describe, expect, it } from 'vitest';
import { fallbackTitle, isGenericTitle, nextChatTitle, uniqueTitle } from './title.js';

describe('fallback chat title', () => {
  it('keeps the words that carry the meaning', () => {
    expect(fallbackTitle('can you help me plan the grocery shopping for tomorrow')).toBe(
      'Help Plan Grocery Shopping',
    );
  });

  it('works in Portuguese too', () => {
    expect(fallbackTitle('me ajuda a organizar as contas do mes que vem')).toBe(
      'Ajuda Organizar Contas Mes',
    );
  });

  it('never returns more than four words', () => {
    expect(fallbackTitle('alpha bravo charlie delta echo foxtrot').split(' ')).toHaveLength(4);
  });

  it('falls back to the raw words when everything is a stop-word', () => {
    expect(fallbackTitle('what is it')).toBe('What Is It');
  });

  it('strips markdown noise and punctuation', () => {
    expect(fallbackTitle('**deploy** the `server`, please!')).toBe('Deploy Server');
  });

  it('de-duplicates against titles already in use', () => {
    expect(fallbackTitle('deploy the server', ['Deploy Server'])).toBe('Deploy Server 2');
    expect(fallbackTitle('deploy the server', ['Deploy Server', 'Deploy Server 2'])).toBe(
      'Deploy Server 3',
    );
  });

  it('handles a message with nothing usable in it', () => {
    expect(fallbackTitle('...')).toBe('New chat');
    expect(fallbackTitle('')).toBe('New chat');
  });

  it('does not run away with a very long word', () => {
    expect(fallbackTitle('x'.repeat(500)).length).toBeLessThanOrEqual(60);
  });
});

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
