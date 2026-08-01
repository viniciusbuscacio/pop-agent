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
  it('penalizes for the default five minutes, then forgives by itself', () => {
    const { cooldown, clock } = build();

    cooldown.penalize('openrouter');
    expect(cooldown.isPenalized('openrouter')).toBe(true);

    clock.value += DEFAULT_COOLDOWN_MS - 1;
    expect(cooldown.isPenalized('openrouter')).toBe(true);

    clock.value += 1;
    expect(cooldown.isPenalized('openrouter')).toBe(false);
  });

  it('is cleared on new evidence: a fresh key or sign-in', () => {
    const { cooldown } = build();
    cooldown.penalize('anthropic');

    cooldown.clear('anthropic');

    expect(cooldown.isPenalized('anthropic')).toBe(false);
  });

  it('filters the penalized out of a chain', () => {
    const { cooldown } = build();
    cooldown.penalize('openrouter');

    const chain = [
      { providerId: 'openrouter', modelId: 'a' },
      { providerId: 'anthropic', modelId: 'b' },
    ];

    expect(cooldown.admissible(chain)).toEqual([{ providerId: 'anthropic', modelId: 'b' }]);
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
