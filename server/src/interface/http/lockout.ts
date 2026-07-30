import type { Clock } from '../../application/ports/clock.js';

/**
 * Progressive lockout for password and recovery-key attempts (popy.spec §9).
 *
 * Popy has exactly one account, so the counter is global rather than per user.
 * The first four misses are free -- typos happen -- and from the fifth the
 * wait doubles: 30s, 60s, 120s, ... capped at fifteen minutes so a locked-out
 * owner is never stuck for the rest of the day.
 *
 * State is in memory on purpose: a restart clears it. That is a deliberate
 * trade (an attacker who can restart the process already owns the box) in
 * exchange for not writing an attacker-controlled counter to disk.
 */

const FREE_ATTEMPTS = 4;
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 15 * 60_000;

export type LockoutStatus = { locked: false } | { locked: true; retryAfterSeconds: number };

export class ProgressiveLockout {
  private failures = 0;
  private lockedUntil = 0;

  constructor(private readonly clock: Clock) {}

  status(): LockoutStatus {
    const remaining = this.lockedUntil - this.clock.now();
    if (remaining <= 0) return { locked: false };
    return { locked: true, retryAfterSeconds: Math.ceil(remaining / 1000) };
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures <= FREE_ATTEMPTS) return;

    const delay = Math.min(BASE_DELAY_MS * 2 ** (this.failures - FREE_ATTEMPTS - 1), MAX_DELAY_MS);
    this.lockedUntil = this.clock.now() + delay;
  }

  /** Called on any successful authentication, including a valid recovery key. */
  reset(): void {
    this.failures = 0;
    this.lockedUntil = 0;
  }
}
