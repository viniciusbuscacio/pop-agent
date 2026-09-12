import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { TokenPayload } from '../../application/auth/token.js';
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

export interface EventTicketGrant {
  session: TokenPayload;
  /** Additive wire schema declared by the client; legacy/absent is version 1. */
  eventVersion: number;
}

interface IssuedTicket extends EventTicketGrant {
  expiresAt: number;
}

export class EventTickets {
  private readonly issued = new Map<string, IssuedTicket>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs: number = DEFAULT_TTL_MS,
  ) {}

  issue(session: TokenPayload, eventVersion = 1): string {
    this.prune();
    const ticket = randomBytes(TICKET_BYTES).toString('base64url');
    this.issued.set(ticket, { expiresAt: this.clock.now() + this.ttlMs, session, eventVersion });
    return ticket;
  }

  /** Accepts a ticket at most once and returns the session it was issued for. */
  consume(candidate: string | undefined): EventTicketGrant | undefined {
    if (candidate === undefined || candidate.length === 0) return undefined;
    this.prune();

    // Compare against stored tickets in constant time. The set is tiny (one
    // per open tab), so walking it costs nothing.
    for (const [ticket, issued] of this.issued) {
      if (!equals(ticket, candidate)) continue;
      this.issued.delete(ticket);
      return issued.expiresAt > this.clock.now()
        ? { session: issued.session, eventVersion: issued.eventVersion }
        : undefined;
    }
    return undefined;
  }

  private prune(): void {
    const now = this.clock.now();
    for (const [ticket, issued] of this.issued) {
      if (issued.expiresAt <= now) this.issued.delete(ticket);
    }
  }
}

function equals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
