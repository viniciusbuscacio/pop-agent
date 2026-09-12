import { describe, expect, it } from 'vitest';
import { DEFAULT_COOLDOWN_MS, ProviderCooldown } from './provider-cooldown.js';

class TickingClock {
  value = 1_700_000_000_000;
  now(): number {
    return this.value;
  }
}

function build(durationMs?: number): { cooldown: ProviderCooldown; clock: TickingClock } {
  const clock = new TickingClock();
  return {
    cooldown: new ProviderCooldown({ clock, ...(durationMs === undefined ? {} : { durationMs }) }),
    clock,
  };
}

describe('ProviderCooldown', () => {
  it('penalizes for one minute on the first strike, then forgives by itself', () => {
    const { cooldown, clock } = build();

    cooldown.penalize('openrouter');
    expect(cooldown.isPenalized('openrouter')).toBe(true);

    clock.value += DEFAULT_COOLDOWN_MS - 1;
    expect(cooldown.isPenalized('openrouter')).toBe(true);

    clock.value += 1;
    expect(cooldown.isPenalized('openrouter')).toBe(false);
  });

  it('lengthens the wait on each strike: one, five, fifteen, sixty minutes', () => {
    const { cooldown, clock } = build();
    const ONE = 1 * 60 * 1000;
    const FIVE = 5 * 60 * 1000;
    const FIFTEEN = 15 * 60 * 1000;
    const SIXTY = 60 * 60 * 1000;

    cooldown.penalize('openrouter');
    clock.value += ONE - 1;
    expect(cooldown.isPenalized('openrouter')).toBe(true);
    clock.value += 1;
    expect(cooldown.isPenalized('openrouter')).toBe(false);

    cooldown.penalize('openrouter');
    clock.value += FIVE - 1;
    expect(cooldown.isPenalized('openrouter')).toBe(true);
    clock.value += 1;
    expect(cooldown.isPenalized('openrouter')).toBe(false);

    cooldown.penalize('openrouter');
    clock.value += FIFTEEN - 1;
    expect(cooldown.isPenalized('openrouter')).toBe(true);
    clock.value += 1;
    expect(cooldown.isPenalized('openrouter')).toBe(false);

    cooldown.penalize('openrouter');
    clock.value += SIXTY - 1;
    expect(cooldown.isPenalized('openrouter')).toBe(true);
    clock.value += 1;
    expect(cooldown.isPenalized('openrouter')).toBe(false);

    // Fifth strike stays at the cap.
    cooldown.penalize('openrouter');
    clock.value += SIXTY - 1;
    expect(cooldown.isPenalized('openrouter')).toBe(true);
  });

  it('uses a flat duration when durationMs is overridden', () => {
    const flat = 42_000;
    const { cooldown, clock } = build(flat);

    cooldown.penalize('openrouter');
    clock.value += flat - 1;
    expect(cooldown.isPenalized('openrouter')).toBe(true);
    clock.value += 1;
    expect(cooldown.isPenalized('openrouter')).toBe(false);
  });

  it('is cleared on new evidence: a fresh key or sign-in resets the ladder', () => {
    const { cooldown } = build();
    cooldown.penalize('anthropic');
    cooldown.penalize('anthropic');

    cooldown.clear('anthropic');

    expect(cooldown.isPenalized('anthropic')).toBe(false);
    // After clear the next strike starts at one minute again.
    cooldown.penalize('anthropic');
    expect(cooldown.isPenalized('anthropic')).toBe(true);
  });

  it('moves a penalized provider behind healthy candidates without removing it', () => {
    const { cooldown } = build();
    cooldown.penalize('openrouter');

    const chain = [
      { providerId: 'openrouter', modelId: 'a' },
      { providerId: 'anthropic', modelId: 'b' },
    ];

    expect(cooldown.admissible(chain)).toEqual([
      { providerId: 'anthropic', modelId: 'b' },
      { providerId: 'openrouter', modelId: 'a' },
    ]);
  });

  it('is advisory: with everyone penalized, the full chain is used anyway', () => {
    const { cooldown } = build();
    cooldown.penalize('openrouter');
    cooldown.penalize('anthropic');

    const chain = [
      { providerId: 'openrouter', modelId: 'a' },
      { providerId: 'anthropic', modelId: 'b' },
    ];

    expect(cooldown.admissible(chain)).toEqual(chain);
  });
});
