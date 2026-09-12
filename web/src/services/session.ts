import { chatCache } from './chat-cache';
import { settingsResources } from './settings-resources';
import { clearSubscriptionUsageCache } from './subscription-usage-cache';

/**
 * Where the session token lives, and the only module that knows.
 *
 * "Keep me signed in" is the whole difference: checked, the token goes to
 * localStorage and survives closing the tab; unchecked, sessionStorage drops
 * it with the tab. If browser storage is denied, an in-memory fallback keeps
 * the authenticated page usable until it closes.
 */

const TOKEN_KEY = 'pop-agent.token';
const PERSIST_KEY = 'pop-agent.persist';
let generation = 0;
let volatileToken: string | undefined;
let volatileStore: 'local' | 'page' | undefined;

function localStore(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function pageStore(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

function read(storage: Storage | undefined, key: string): string | undefined {
  try {
    return storage?.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function write(storage: Storage | undefined, key: string, value: string): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // The in-memory token remains authoritative for this page.
  }
}

function remove(storage: Storage | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // The in-memory token remains authoritative for this page.
  }
}

function persistent(): boolean {
  return read(localStore(), PERSIST_KEY) === '1';
}

function selectedStore(): Storage | undefined {
  const useLocal = volatileStore === undefined ? persistent() : volatileStore === 'local';
  return useLocal ? localStore() : pageStore();
}

function otherStore(): Storage | undefined {
  const useLocal = volatileStore === undefined ? persistent() : volatileStore === 'local';
  return useLocal ? pageStore() : localStore();
}

export const session = {
  /** Changes on explicit login/logout, even if a server reissues the same token. */
  generation(): number {
    return generation;
  },
  token(): string | undefined {
    // The alternate read recovers from a preference write that failed after a
    // previous session left the opposite value behind.
    return read(selectedStore(), TOKEN_KEY) ?? read(otherStore(), TOKEN_KEY) ?? volatileToken;
  },

  /** Called after a successful sign-in, when the checkbox decides the storage. */
  start(token: string, keepSignedIn: boolean): void {
    chatCache.clear();
    settingsResources.clear();
    clearSubscriptionUsageCache();
    generation += 1;
    volatileToken = token;
    volatileStore = keepSignedIn ? 'local' : 'page';
    remove(localStore(), TOKEN_KEY);
    remove(pageStore(), TOKEN_KEY);
    write(localStore(), PERSIST_KEY, keepSignedIn ? '1' : '0');
    // Choose from the requested behavior rather than rereading a preference
    // that a denied localStorage could not persist.
    write(keepSignedIn ? localStore() : pageStore(), TOKEN_KEY, token);
  },

  /** A renewed token from `x-pop-agent-token`: same storage, new value. */
  refresh(token: string): void {
    volatileToken = token;
    write(selectedStore(), TOKEN_KEY, token);
  },

  /** Whether the current token was intentionally chosen to survive the tab. */
  isPersistent(): boolean {
    return volatileStore === undefined ? persistent() : volatileStore === 'local';
  },

  clear(): void {
    settingsResources.clear();
    clearSubscriptionUsageCache();
    generation += 1;
    volatileToken = undefined;
    volatileStore = undefined;
    remove(localStore(), TOKEN_KEY);
    remove(pageStore(), TOKEN_KEY);
    // Cached transcripts belong to the authenticated session. Never let a
    // later account on the same browser inherit the previous one's history.
    chatCache.clear();
  },
};
