import { describe, expect, it } from 'vitest';
import type { Clock } from '../../application/ports/clock.js';
import { EventTickets } from './event-tickets.js';

const session = { epoch: 7, iat: 900, exp: 50_000 };

describe('SSE event tickets', () => {
  it('returns the authenticated session exactly once', () => {
    const now = 1_000;
    const tickets = new EventTickets({ now: () => now } satisfies Clock);
    const ticket = tickets.issue(session, 2);
    const another = tickets.issue(session, 2);

    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(another).not.toBe(ticket);
    expect(tickets.consume(ticket)).toEqual({ session, eventVersion: 2 });
    expect(tickets.consume(ticket)).toBeUndefined();
  });

  it('expires without revealing the bound session', () => {
    let now = 1_000;
    const tickets = new EventTickets({ now: () => now } satisfies Clock, 30_000);
    const ticket = tickets.issue(session);

    now = 31_000;

    expect(tickets.consume(ticket)).toBeUndefined();
  });

  it('rejects empty and invented tickets', () => {
    const tickets = new EventTickets({ now: () => 1_000 } satisfies Clock);
    tickets.issue(session);

    expect(tickets.consume(undefined)).toBeUndefined();
    expect(tickets.consume('not-issued')).toBeUndefined();
  });
});
