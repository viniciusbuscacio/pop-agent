import type { Clock } from '../ports/clock.js';

/**
 * The advisory cooldown behind failover (pop-agent.spec §15, fase 2): a provider
 * that just refused a run is skipped by the next chains for a while, so one dead
 * key does not tax every conversation with a doomed first try.
 *
 * Each penalty adds a strike and lengthens the wait -- 1 min, then 5, 15, 60
 * (cap) -- so a two-second blip is not punished like a provider that has been
 * dead for days, and a chronic failure is not retried every five minutes
 * forever. `clear` resets the ladder: a fresh key, sign-in, or success is new
 * evidence and deserves a first try immediately.
 *
 * Advisory, never a hard block: when every candidate is penalized the full
 * chain is used anyway -- a wrong penalty must degrade to "we tried", not to
 * "nothing answered". In-memory on purpose; a restart forgives everyone.
 */

/** First-strike duration; kept so tests can name the ladder without magic. */
export const DEFAULT_COOLDOWN_MS = 1 * 60 * 1000;

const COOLDOWN_LADDER_MS = [
  1 * 60 * 1000,
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
] as const;

export interface ProviderCooldownDeps {
  clock: Clock;
  /** Overridable so tests do not wait five minutes. */
  durationMs?: number;
}

export class ProviderCooldown {
  private readonly penalizedUntil = new Map<string, number>();
  private readonly strikes = new Map<string, number>();

  constructor(private readonly deps: ProviderCooldownDeps) {}

  penalize(providerId: string): void {
    if (this.deps.durationMs !== undefined) {
      this.penalizedUntil.set(providerId, this.deps.clock.now() + this.deps.durationMs);
      return;
    }
    const strike = (this.strikes.get(providerId) ?? 0) + 1;
    this.strikes.set(providerId, strike);
    const duration = COOLDOWN_LADDER_MS[Math.min(strike - 1, COOLDOWN_LADDER_MS.length - 1)]!;
    this.penalizedUntil.set(providerId, this.deps.clock.now() + duration);
  }

  /** Forgiveness on new evidence: a fresh key, sign-in, or success resets the ladder. */
  clear(providerId: string): void {
    this.penalizedUntil.delete(providerId);
    this.strikes.delete(providerId);
  }

  isPenalized(providerId: string): boolean {
    const until = this.penalizedUntil.get(providerId);
    if (until === undefined) return false;
    if (until <= this.deps.clock.now()) {
      this.penalizedUntil.delete(providerId);
      return false;
    }
    return true;
  }

  /**
   * The candidates worth trying: the non-penalized subset -- or, when every
   * one of them is penalized, the whole list unchanged (the advisory rule).
   */
  admissible<T extends { providerId: string }>(candidates: T[]): T[] {
    const open = candidates.filter((candidate) => !this.isPenalized(candidate.providerId));
    return open.length > 0 ? open : candidates;
  }
}
