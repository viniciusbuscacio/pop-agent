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
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.setItem(PERSIST_KEY, keepSignedIn ? '1' : '0');
    store()?.setItem(TOKEN_KEY, token);
  },

  /** A renewed token from `x-pop-agent-token`: same storage, new value. */
  refresh(token: string): void {
    store()?.setItem(TOKEN_KEY, token);
  },

  clear(): void {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    // Cached transcripts belong to the authenticated session. Never let a
    // later account on the same browser inherit the previous one's history.
    chatCache.clear();
  },
};
