import { createCoalescedWriter } from './coalesced-writer';
import type { ChatDTO, MessageDTO } from '@pop-agent/shared';

/**
 * A small, device-local transcript cache. The server remains authoritative:
 * this only gives ChatPage something useful to paint while openChat verifies
 * the current tail in the background.
 */
const DATABASE = 'pop-agent-chat-cache';
const STORE = 'transcripts';
const VERSION = 2;
let generation = 0;
let storageFailed = false;
const writer = createCoalescedWriter();
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
      if (!database.objectStoreNames.contains('lists')) database.createObjectStore('lists');
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
  storageFailed: () => storageFailed,
  async getLists(): Promise<{ chats: ChatDTO[]; archived: ChatDTO[] } | undefined> {
    const started = generation;
    const db = await database();
    if (!db) return undefined;
    try {
      const result = await requestResult(db.transaction('lists').objectStore('lists').get('all')) as { chats: ChatDTO[]; archived: ChatDTO[] } | undefined;
      return started === generation && Array.isArray(result?.chats) && Array.isArray(result?.archived) ? result : undefined;
    } catch { return undefined; }
    finally { db.close(); }
  },
  async putLists(chats: ChatDTO[], archived: ChatDTO[]): Promise<void> {
    const started = generation;
    return writer.add('lists', async () => {
      const db = await database();
      if (!db) return;
      try {
        if (started !== generation) return;
        const tx = db.transaction('lists', 'readwrite');
        tx.objectStore('lists').put({ chats, archived }, 'all');
        await transactionDone(tx);
      } catch { storageFailed = true; }
      finally { db.close(); }
    });
  },
  async get(chatId: string): Promise<MessageDTO[] | undefined> {
    const started = generation;
    const db = await database();
    if (db === undefined) return undefined;
    try {
      const transaction = db.transaction(STORE, 'readonly');
      const store = transaction.objectStore(STORE);
      const cached = await requestResult(store.get(chatId)) as CachedTranscript | undefined;
      await transactionDone(transaction);
      return started === generation ? cached?.messages : undefined;
    } catch {
      return undefined;
    } finally {
      db.close();
    }
  },

  async put(chatId: string, messages: MessageDTO[]): Promise<void> {
    const started = generation;
    return writer.add(`chat:${chatId}`, async () => {
      const db = await database();
      if (db === undefined) return;
      try {
        if (started !== generation) return;
        const byteSize = encodedSize(messages);
        if (byteSize > CHAT_CACHE_MAX_BYTES) { storageFailed = true; return; }
        const transaction = db.transaction(STORE, 'readwrite');
        const store = transaction.objectStore(STORE);
        store.put({ chatId, messages, byteSize, accessedAt: Date.now() } satisfies CachedTranscript);
        // Browser quota bounds total storage. Do not evict other conversations
        // during a full warmup, which would create a perpetual redownload loop.
        await transactionDone(transaction);
      } catch {
        storageFailed = true;
      } finally {
        db.close();
      }
    });
  },

  async remove(chatId: string): Promise<void> {
    const started = generation;
    return writer.add(`chat:${chatId}`, async () => {
      const db = await database();
      if (db === undefined) return;
      try {
        if (started !== generation) return;
        const transaction = db.transaction(STORE, 'readwrite');
        transaction.objectStore(STORE).delete(chatId);
        await transactionDone(transaction);
      } catch {
        // Best-effort cache invalidation; the server still rejects a deleted id.
      } finally {
        db.close();
      }
    });
  },

  clear(): void {
    generation++;
    writer.clear();
    storageFailed = false;
    if (!available()) return;
    // Deleting the database also removes entries from older schema versions.
    try {
      indexedDB.deleteDatabase(DATABASE);
    } catch {
      // Signing out must never be blocked by storage cleanup.
    }
  },
};
