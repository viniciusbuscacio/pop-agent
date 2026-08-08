import type { Clock } from '../ports/clock.js';

/**
 * The advisory cooldown behind failover (pop-agent.spec §15, fase 2): a provider
 * that just refused a run is skipped by the next chains for a few minutes,
 * so one dead key does not tax every conversation with a doomed first try.
 *
 * Advisory, never a hard block: when every candidate is penalized the full
 * chain is used anyway -- a wrong penalty must degrade to "we tried", not to
 * "nothing answered". In-memory on purpose; a restart forgives everyone.
 */

export const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

export interface ProviderCooldownDeps {
  clock: Clock;
  /** Overridable so tests do not wait five minutes. */
  durationMs?: number;
}

export class ProviderCooldown {
  private readonly penalizedUntil = new Map<string, number>();

  constructor(private readonly deps: ProviderCooldownDeps) {}

  penalize(providerId: string): void {
    this.penalizedUntil.set(
      providerId,
      this.deps.clock.now() + (this.deps.durationMs ?? DEFAULT_COOLDOWN_MS),
    );
  }

  /** Forgiveness on new evidence: a fresh key or a fresh sign-in. */
  clear(providerId: string): void {
    this.penalizedUntil.delete(providerId);
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
