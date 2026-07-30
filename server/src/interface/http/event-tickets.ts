import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../../application/ports/clock.js';

/**
 * One-time tickets for the SSE stream.
 *
 * `EventSource` cannot send an Authorization header, and putting the session
 * token in the query string would write it into every access log, proxy trace
 * and browser history entry it passes through. So an authenticated request
 * trades the token for a ticket that is good for one connection and thirty
 * seconds, and the stream URL carries only that.
 *
 * In memory on purpose: tickets are worthless a moment after they are issued,
 * and a restart dropping them costs a reconnect.
 */

const TICKET_BYTES = 32;
const DEFAULT_TTL_MS = 30_000;

export class EventTickets {
  private readonly issued = new Map<string, number>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  issue(): string {
    this.prune();
    const ticket = randomBytes(TICKET_BYTES).toString('base64url');
    this.issued.set(ticket, this.clock.now() + this.ttlMs);
    return ticket;
  }

  /** Accepts a ticket at most once, and only inside its window. */
  consume(candidate: string | undefined): boolean {
    if (candidate === undefined || candidate.length === 0) return false;
    this.prune();

    // Compare against stored tickets in constant time. The set is tiny (one
    // per open tab), so walking it costs nothing.
    for (const [ticket, expiresAt] of this.issued) {
      if (!equals(ticket, candidate)) continue;
      this.issued.delete(ticket);
      return expiresAt > this.clock.now();
    }
    return false;
  }

  private prune(): void {
    const now = this.clock.now();
    for (const [ticket, expiresAt] of this.issued) {
      if (expiresAt <= now) this.issued.delete(ticket);
    }
  }
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
