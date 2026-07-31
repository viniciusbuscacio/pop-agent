import type { EventTicketResponse, StreamEvent } from '@popy/shared';
import { apiRequest } from './api';

/**
 * The single EventSource (popy.spec §14). Components never see it: they read
 * the store, which this file feeds.
 *
 * Connecting takes two steps because EventSource cannot send a header — ask
 * for a one-time ticket with the session, then open the stream with it. A
 * reconnect needs a fresh ticket, since each one is spent on use.
 */

type Listener = (event: StreamEvent) => void;

const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 15_000;

let source: EventSource | undefined;
let retryMs = FIRST_RETRY_MS;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = true;
const listeners = new Set<Listener>();

export const eventStream = {
  /** Idempotent: calling it twice keeps the one connection. */
  start(): void {
    stopped = false;
    if (source !== undefined) return;
    void connect();
  },

  stop(): void {
    stopped = true;
    if (retryTimer !== undefined) clearTimeout(retryTimer);
    retryTimer = undefined;
    source?.close();
    source = undefined;
    retryMs = FIRST_RETRY_MS;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

async function connect(): Promise<void> {
  if (stopped) return;

  let ticket: string;
  try {
    ({ ticket } = await apiRequest<EventTicketResponse>('/events/ticket', { method: 'POST' }));
  } catch {
    // No session, or the server is down. Either way, back off and retry: the
    // api layer has already redirected to login if the session was the problem.
    scheduleRetry();
    return;
  }
  if (stopped) return;

  const connection = new EventSource(`/v1/events?ticket=${encodeURIComponent(ticket)}`);
  source = connection;

  connection.addEventListener('open', () => {
    retryMs = FIRST_RETRY_MS;
  });

  connection.addEventListener('message', (message: MessageEvent<string>) => {
    let parsed: StreamEvent;
    try {
      parsed = JSON.parse(message.data) as StreamEvent;
    } catch {
      return;
    }
    for (const listener of listeners) listener(parsed);
  });

  connection.addEventListener('error', () => {
    // EventSource retries on its own, but it would replay the spent ticket, so
    // take over: close, wait, ask for a new one.
    connection.close();
    if (source === connection) source = undefined;
    scheduleRetry();
  });
}

function scheduleRetry(): void {
  if (stopped || retryTimer !== undefined) return;
  retryTimer = setTimeout(() => {
    retryTimer = undefined;
    void connect();
  }, retryMs);
  retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
}
