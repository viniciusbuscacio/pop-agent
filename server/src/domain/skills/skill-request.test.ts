import { describe, expect, it } from 'vitest';
import { asksForSkill } from './skill-request.js';

describe('asksForSkill', () => {
  it('hears the request in the languages Popy is spoken to', () => {
    for (const message of [
      'isso ai foi otimo, vira skill',
      'Transforma isso numa skill por favor',
      'salva como skill',
      'turn this into a skill',
      'save it as a skill so you remember',
      'conviertelo en una skill',
    ]) {
      expect(asksForSkill(message)).toBe(true);
    }
  });

  it('does not hear a question about skills as an order to write one', () => {
    // The word alone cannot separate the two, which is why every phrase in the
    // list carries the verb. `skill-creator` was routed by meaning and answered
    // on turns like these; the whole point of matching phrases is that it stops.
    for (const message of [
      'quantas skills voce tem?',
      'me explica como funcionam as skills',
      'essa skill ficou boa',
      'pensei em algum nome brasileiro q terminasse por IA',
    ]) {
      expect(asksForSkill(message)).toBe(false);
    }
  });

  it('reads through case and accents', () => {
    expect(asksForSkill('VIRA SKILL')).toBe(true);
    expect(asksForSkill('transformar isso numa skill')).toBe(true);
  });
});
