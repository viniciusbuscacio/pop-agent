import { chatCache } from './chat-cache';

/**
 * Where the session token lives, and the only module that knows.
 *
 * "Keep me signed in" is the whole difference: checked, the token goes to
 * localStorage and survives closing the tab; unchecked, sessionStorage drops
 * it with the tab. The rest of the app just asks for `token` (pop-agent.spec §9).
 */

const TOKEN_KEY = 'pop-agent.token';
const PERSIST_KEY = 'pop-agent.persist';
const DESKTOP_SESSION_HANDLER = 'popSession';

interface DesktopMessageHandler {
  postMessage(message: { kind: 'session'; token: string }): void;
}

interface DesktopWindow extends Window {
  webkit?: { messageHandlers?: Record<string, DesktopMessageHandler | undefined> };
}

/**
 * The native Desktop owns the Node/PLA child, but the PWA owns its session.
 * This one-way, session-only message is the whole bridge: it exposes no local
 * filesystem or command API to web content. The host additionally validates
 * the main frame and configured server origin before accepting it.
 */
function notifyDesktop(token: string | undefined): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  if (!/\bPopDesktop\/[0-9.]+\b/.test(navigator.userAgent)) return;
  const handler = (window as DesktopWindow).webkit?.messageHandlers?.[DESKTOP_SESSION_HANDLER];
  handler?.postMessage({ kind: 'session', token: token ?? '' });
}

function persistent(): boolean {
  try {
    return localStorage.getItem(PERSIST_KEY) === '1';
  } catch {
    return false;
  }
}

function store(): Storage | undefined {
  try {
    return persistent() ? localStorage : sessionStorage;
  } catch {
    // Private modes can deny storage entirely; the app still works for the
    // life of the page, it just cannot remember anything.
    return undefined;
  }
}

export const session = {
  token(): string | undefined {
    return store()?.getItem(TOKEN_KEY) ?? undefined;
  },

  /** Called after a successful sign-in, when the checkbox decides the storage. */
  start(token: string, keepSignedIn: boolean): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.setItem(PERSIST_KEY, keepSignedIn ? '1' : '0');
      store()?.setItem(TOKEN_KEY, token);
    } finally {
      notifyDesktop(token);
    }
  },

  /** A renewed token from `x-pop-agent-token`: same storage, new value. */
  refresh(token: string): void {
    store()?.setItem(TOKEN_KEY, token);
    notifyDesktop(token);
  },

  clear(): void {
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } finally {
      notifyDesktop(undefined);
    }
    // Cached transcripts belong to the authenticated session. Never let a
    // later account on the same browser inherit the previous one's history.
    chatCache.clear();
  },

  /** Sends an already persisted session when the native host first loads the PWA. */
  syncDesktop(): void {
    notifyDesktop(this.token());
  },
};
