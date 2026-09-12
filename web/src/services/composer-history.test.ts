// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import {
  appendComposerHistory,
  COMPOSER_HISTORY_LIMIT,
  readComposerHistory,
} from './composer-history';

afterEach(() => {
  localStorage.clear();
});

describe('composer history', () => {
  it('keeps independent histories for each chat', () => {
    appendComposerHistory('chat-a', 'first A');
    appendComposerHistory('chat-b', 'first B');
    appendComposerHistory('chat-a', 'second A');

    expect(readComposerHistory('chat-a')).toEqual(['first A', 'second A']);
    expect(readComposerHistory('chat-b')).toEqual(['first B']);
  });

  it('retains only the latest one hundred submitted messages', () => {
    for (let index = 0; index <= COMPOSER_HISTORY_LIMIT; index += 1) {
      appendComposerHistory('chat-a', `message ${String(index)}`);
    }

    const history = readComposerHistory('chat-a');
    expect(history).toHaveLength(COMPOSER_HISTORY_LIMIT);
    expect(history[0]).toBe('message 1');
    expect(history.at(-1)).toBe('message 100');
  });

  it('treats malformed or unrelated stored data as empty history', () => {
    localStorage.setItem('pop-agent.composerHistory.chat-a', '{broken');
    localStorage.setItem('pop-agent.composerHistory.chat-b', JSON.stringify({ text: 'nope' }));

    expect(readComposerHistory('chat-a')).toEqual([]);
    expect(readComposerHistory('chat-b')).toEqual([]);
  });
});
