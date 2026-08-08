import type { EventTicketResponse, StreamEvent } from '@pop-agent/shared';
import { apiRequest } from './api';

/**
 * The single EventSource (pop-agent.spec §14). Components never see it: they read
 * the store, which this file feeds.
 *
 * Connecting takes two steps because EventSource cannot send a header — ask
 * for a one-time ticket with the session, then open the stream with it. A
 * reconnect needs a fresh ticket, since each one is spent on use.
 *
 * Coming back from the background is its own case. iOS suspends a backgrounded
 * PWA: the connection dies and the retry timer freezes with it, so waiting for
 * the backoff would leave the app looking frozen for as long as it slept. The
 * page becoming visible reconnects immediately and tells the app to refetch,
 * because whatever happened while it slept was never delivered.
 */

type Listener = (event: StreamEvent) => void;
type ResumeListener = () => void;

const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 15_000;

let source: EventSource | undefined;
let retryMs = FIRST_RETRY_MS;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let stopped = true;
let watchingVisibility = false;
/** Whether the stream has ever opened; a later open is a reconnection. */
let everConnected = false;
const listeners = new Set<Listener>();
const resumeListeners = new Set<ResumeListener>();

export const eventStream = {
  /** Idempotent: calling it twice keeps the one connection. */
  start(): void {
    stopped = false;
    watchVisibility();
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
    // A fresh start (after a logout/login) must treat its first open as a
    // first connection, not a reconnection, so it does not fire a catch-up.
    everConnected = false;
  },

  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  /** Fires when the app comes back to the foreground and has to catch up. */
  onResume(listener: ResumeListener): () => void {
    resumeListeners.add(listener);
    return () => {
      resumeListeners.delete(listener);
    };
  },
};

function watchVisibility(): void {
  if (watchingVisibility || typeof document === 'undefined') return;
  watchingVisibility = true;

  const wake = (): void => {
    if (stopped || document.visibilityState !== 'visible') return;

    retryMs = FIRST_RETRY_MS;
    if (retryTimer !== undefined) {
      clearTimeout(retryTimer);
      retryTimer = undefined;
    }

    // A connection that survived is kept; one the system tore down is
    // replaced right away instead of after a backoff that never ticked.
    if (source === undefined || source.readyState === EventSource.CLOSED) {
      source?.close();
      source = undefined;
      void connect();
    }

    for (const listener of resumeListeners) listener();
  };

  document.addEventListener('visibilitychange', wake);
  // Safari restoring from the back/forward cache does not always fire
  // visibilitychange, but it does fire pageshow.
  window.addEventListener('pageshow', wake);
}

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
    // A later open is a reconnection: the stream was down for a while -- a
    // server restart, a network blip -- and any events in that gap were
    // missed. Tell the app to catch up, exactly like returning from the
    // background, so a run the server ended while we were disconnected is
    // reconciled instead of spinning forever. A foreground desktop tab never
    // fires visibilitychange, so without this its stuck run would never clear.
    if (everConnected) {
      for (const listener of resumeListeners) listener();
    }
    everConnected = true;
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
