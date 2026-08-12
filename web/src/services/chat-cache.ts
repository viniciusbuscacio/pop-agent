import type { MessageDTO } from '@pop-agent/shared';

/**
 * A small, device-local transcript cache. The server remains authoritative:
 * this only gives ChatPage something useful to paint while openChat verifies
 * the current tail in the background.
 */
const DATABASE = 'pop-agent-chat-cache';
const STORE = 'transcripts';
const VERSION = 1;
export const CHAT_CACHE_MAX_BYTES = 50 * 1024 * 1024;

interface CachedTranscript {
  chatId: string;
  messages: MessageDTO[];
  byteSize: number;
  accessedAt: number;
}

function available(): boolean {
  return typeof indexedDB !== 'undefined';
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, { keyPath: 'chatId' });
        store.createIndex('accessedAt', 'accessedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the chat cache.'));
  });
}

async function database(): Promise<IDBDatabase | undefined> {
  if (!available()) return undefined;
  try {
    return await openDatabase();
  } catch {
    // Storage can be denied or unavailable (notably in private browsing). The
    // online app must keep working exactly as it did before the cache existed.
    return undefined;
  }
}

function encodedSize(messages: MessageDTO[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).byteLength;
}

export const chatCache = {
  async get(chatId: string): Promise<MessageDTO[] | undefined> {
    const db = await database();
    if (db === undefined) return undefined;
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const cached = await requestResult(store.get(chatId)) as CachedTranscript | undefined;
      if (cached !== undefined) store.put({ ...cached, accessedAt: Date.now() });
      await transactionDone(transaction);
      return cached?.messages;
    } catch {
      return undefined;
    } finally {
      db.close();
    }
  },

  async put(chatId: string, messages: MessageDTO[]): Promise<void> {
    const db = await database();
    if (db === undefined) return;
    try {
      const byteSize = encodedSize(messages);
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      if (byteSize > CHAT_CACHE_MAX_BYTES) {
        store.delete(chatId);
      } else {
        store.put({ chatId, messages, byteSize, accessedAt: Date.now() } satisfies CachedTranscript);
        const entries = await requestResult(store.getAll()) as CachedTranscript[];
        let total = entries.reduce((sum, entry) => sum + entry.byteSize, 0);
        for (const entry of entries.sort((a, b) => a.accessedAt - b.accessedAt)) {
          if (total <= CHAT_CACHE_MAX_BYTES) break;
          store.delete(entry.chatId);
          total -= entry.byteSize;
        }
      }
      await transactionDone(transaction);
    } catch {
      // Quota pressure or a denied write only disables this optimization.
    } finally {
      db.close();
    }
  },

  async remove(chatId: string): Promise<void> {
    const db = await database();
    if (db === undefined) return;
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(chatId);
      await transactionDone(transaction);
    } catch {
      // Best-effort cache invalidation; the server still rejects a deleted id.
    } finally {
      db.close();
    }
  },

  clear(): void {
    if (!available()) return;
    // Deleting the database also removes entries from older schema versions.
    try {
      indexedDB.deleteDatabase(DATABASE);
    } catch {
      // Signing out must never be blocked by storage cleanup.
    }
  },
};
