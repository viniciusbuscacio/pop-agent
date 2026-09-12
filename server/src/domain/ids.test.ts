import { describe, expect, it } from 'vitest';
import {
  newChatId,
  newMessageId,
  newQueuedMessageId,
  newRunId,
  randomBase62,
  randomFileName,
} from './ids.js';

const BASE62_11 = /^[A-Za-z0-9]{11}$/;

describe('identifiers', () => {
  it('carry a full-word prefix and 11 base62 characters', () => {
    expect(newChatId()).toMatch(/^chat-[A-Za-z0-9]{11}$/);
    expect(newMessageId()).toMatch(/^message-[A-Za-z0-9]{11}$/);
    expect(newRunId()).toMatch(/^run-[A-Za-z0-9]{11}$/);
    expect(newQueuedMessageId()).toMatch(/^queued-[A-Za-z0-9]{11}$/);
  });

  it('do not repeat', () => {
    const ids = new Set(Array.from({ length: 5000 }, () => newChatId()));
    expect(ids.size).toBe(5000);
  });

  it('say nothing about how many exist or when they were made', () => {
    const first = newChatId().slice(5);
    const second = newChatId().slice(5);
    expect(first.slice(0, 4)).not.toBe(second.slice(0, 4));
  });
});

describe('randomBase62', () => {
  it('produces the requested length from the base62 alphabet', () => {
    for (let i = 0; i < 200; i += 1) expect(randomBase62(11)).toMatch(BASE62_11);
  });

  it('uses the whole alphabet over many draws (no obvious bias)', () => {
    const seen = new Set([...Array.from({ length: 2000 }, () => randomBase62(11)).join('')]);
    // 62 symbols; a fair generator hits nearly all of them in 22000 characters.
    expect(seen.size).toBeGreaterThan(55);
  });
});

describe('randomFileName', () => {
  it('is prefix_<11 base62>.ext with an underscore, not a hyphen', () => {
    expect(randomFileName('audio', 'wav')).toMatch(/^audio_[A-Za-z0-9]{11}\.wav$/);
    expect(randomFileName('text', '.txt')).toMatch(/^text_[A-Za-z0-9]{11}\.txt$/);
  });
});
