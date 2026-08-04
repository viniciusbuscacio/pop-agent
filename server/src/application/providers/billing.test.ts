import { describe, expect, it } from 'vitest';
import { billsPerToken } from './provider-definitions.js';

/**
 * A screen about money must never round upward. pi reports a catalogue cost
 * for every run, and booking it for a subscription overstated real spending by
 * ~US$4.90 across 151 runs before anyone read the number closely.
 */
describe('billsPerToken', () => {
  it('says a key provider bills', () => {
    expect(billsPerToken('openrouter')).toBe(true);
    expect(billsPerToken('openai')).toBe(true);
    expect(billsPerToken('anthropic')).toBe(true);
  });

  it('says a subscription does not', () => {
    expect(billsPerToken('openai-codex')).toBe(false);
    expect(billsPerToken('github-copilot')).toBe(false);
  });

  it('assumes an unknown provider bills, because guessing free hides a cost', () => {
    // A custom OpenAI-compatible endpoint is somebody's paid key.
    expect(billsPerToken('custom-a1b2c3d4e5')).toBe(true);
    expect(billsPerToken('')).toBe(true);
  });
});
