import type { EventTicketResponse, StreamEvent } from '@pop-agent/shared';
import { apiRequest } from './api';
import { createStreamEventBatcher } from './stream-event-batcher';

/**
 * The session-wide EventSource. Components subscribe to this service rather
 * than opening connections of their own.
 *
 * EventSource cannot carry the session header, so every connection first asks
 * the authenticated API for a one-use ticket. Pop owns retry instead of
 * EventSource because a spent ticket cannot be replayed.
 */

type Listener = (event: StreamEvent) => void;
type ResumeListener = () => void;
type ConnectReason = 'initial' | 'retry' | 'resume';

const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 15_000;

export interface EventStreamEnvironment {
  issueTicket(): Promise<string>;
  open(url: string): EventSource;
  document?: Document;
  window?: Window;
  schedule(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  cancel(handle: ReturnType<typeof setTimeout>): void;
}

export interface EventStreamService {
  start(): void;
  stop(): void;
  subscribe(listener: Listener): () => void;
  onResume(listener: ResumeListener): () => void;
}

/** Creates an isolated stream controller; exported so lifecycle races are testable. */
export function createEventStream(environment: EventStreamEnvironment): EventStreamService {
  let source: EventSource | undefined;
  let retryMs = FIRST_RETRY_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  let connectingAttempt: number | undefined;
  let generation = 0;
  let watchingVisibility = false;
  let wasHidden = false;
  const listeners = new Set<Listener>();
  const resumeListeners = new Set<ResumeListener>();
  const bufferedEvents = createStreamEventBatcher((event) => {
    for (const listener of listeners) listener(event);
  });

  const notifyResume = (): void => {
    for (const listener of resumeListeners) listener();
  };

  const cancelRetry = (): void => {
    if (retryTimer !== undefined) environment.cancel(retryTimer);
    retryTimer = undefined;
  };

  const scheduleRetry = (): void => {
    if (stopped || retryTimer !== undefined || connectingAttempt !== undefined || source !== undefined) {
      return;
    }
    const delay = retryMs;
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    retryTimer = environment.schedule(() => {
      retryTimer = undefined;
      beginConnect('retry');
    }, delay);
  };

  const connect = async (attempt: number, reason: ConnectReason): Promise<void> => {
    let ticket: string;
    try {
      ticket = await environment.issueTicket();
    } catch {
      if (connectingAttempt !== attempt || stopped) return;
      connectingAttempt = undefined;
      scheduleRetry();
      return;
    }

    // A stop, foreground replacement or newer attempt can win while the ticket
    // request is in flight. Such a ticket is simply left to expire unused.
    if (stopped || connectingAttempt !== attempt) return;
    connectingAttempt = undefined;

    const connection = environment.open(`/v1/events?ticket=${encodeURIComponent(ticket)}`);
    source = connection;

    connection.addEventListener('open', () => {
      if (source !== connection || stopped) return;
      retryMs = FIRST_RETRY_MS;
      // A retry may cover an arbitrarily long gap. Consumers need a canonical
      // snapshot after the replacement is actually open, including foreground
      // recovery: a snapshot before opening would leave an unobserved gap.
      if (reason !== 'initial') notifyResume();
    });

    connection.addEventListener('message', (message: MessageEvent<string>) => {
      if (source !== connection || stopped) return;
      let parsed: StreamEvent;
      try {
        parsed = JSON.parse(message.data) as StreamEvent;
      } catch {
        return;
      }
      bufferedEvents.push(parsed);
    });

    connection.addEventListener('error', () => {
      connection.close();
      // A superseded EventSource may report its close after the replacement is
      // already live. It must not clear that source or schedule a third one.
      if (source !== connection || stopped) return;
      source = undefined;
      scheduleRetry();
    });
  };

  const beginConnect = (reason: ConnectReason): void => {
    if (stopped || source !== undefined || connectingAttempt !== undefined) return;
    const attempt = ++generation;
    connectingAttempt = attempt;
    void connect(attempt, reason);
  };

  const replaceAfterResume = (): void => {
    if (stopped) return;
    retryMs = FIRST_RETRY_MS;
    cancelRetry();
    // Invalidate a ticket request as well as a live source. iOS can leave a
    // suspended EventSource reporting OPEN even though no more events arrive.
    generation += 1;
    connectingAttempt = undefined;
    source?.close();
    source = undefined;
    beginConnect('resume');
  };

  const onVisibilityChange = (): void => {
    const document = environment.document;
    if (document === undefined) return;
    if (document.visibilityState !== 'visible') {
      wasHidden = true;
      return;
    }
    if (!wasHidden) return;
    wasHidden = false;
    replaceAfterResume();
  };

  const onPageShow = (event: PageTransitionEvent): void => {
    // Initial pageshow is not a resume. `persisted` identifies a document
    // restored from Safari's/another browser's back-forward cache.
    if (event.persisted) replaceAfterResume();
  };

  const watchVisibility = (): void => {
    if (watchingVisibility) return;
    const document = environment.document;
    const window = environment.window;
    if (document === undefined || window === undefined) return;
    watchingVisibility = true;
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
  };

  const unwatchVisibility = (): void => {
    if (!watchingVisibility) return;
    environment.document?.removeEventListener('visibilitychange', onVisibilityChange);
    environment.window?.removeEventListener('pageshow', onPageShow);
    watchingVisibility = false;
    wasHidden = false;
  };

  return {
    /** Idempotent even while the ticket request is still in flight. */
    start(): void {
      stopped = false;
      watchVisibility();
      beginConnect('initial');
    },

    stop(): void {
      stopped = true;
      generation += 1;
      connectingAttempt = undefined;
      cancelRetry();
      source?.close();
      source = undefined;
      bufferedEvents.clear();
      retryMs = FIRST_RETRY_MS;
      unwatchVisibility();
    },

    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onResume(listener: ResumeListener): () => void {
      resumeListeners.add(listener);
      return () => resumeListeners.delete(listener);
    },
  };
}

function browserEnvironment(): EventStreamEnvironment {
  return {
    issueTicket: async () => {
      const { ticket } = await apiRequest<EventTicketResponse>('/events/ticket', { method: 'POST' });
      return ticket;
    },
    open: (url) => new EventSource(url),
    ...(typeof document === 'undefined' ? {} : { document }),
    ...(typeof window === 'undefined' ? {} : { window }),
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: (handle) => clearTimeout(handle),
  };
}

export const eventStream = createEventStream(browserEnvironment());
