import type { Clock } from '../../application/ports/clock.js';

/**
 * Sliding-window rate limit for the credential routes (popy.spec §9). In
 * memory, like the lockout: one process, one account.
 *
 * Behind `tailscale serve` every request arrives from 127.0.0.1, so in the
 * home setup this collapses to a single global window. That is acceptable for
 * a single-user app -- and the moment Popy sits behind a real proxy that sets
 * X-Forwarded-For, the same code starts limiting per client.
 */
export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly clock: Clock,
  ) {}

  check(origin: string): RateLimitDecision {
    const now = this.clock.now();
    const cutoff = now - this.windowMs;
    const recent = (this.hits.get(origin) ?? []).filter((at) => at > cutoff);

    if (recent.length >= this.limit) {
      const oldest = recent[0] as number;
      this.hits.set(origin, recent);
      return { allowed: false, retryAfterSeconds: Math.ceil((oldest + this.windowMs - now) / 1000) };
    }

    recent.push(now);
    this.hits.set(origin, recent);
    return { allowed: true };
  }
}
