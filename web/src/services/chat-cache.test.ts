// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageDTO } from '@pop-agent/shared';

class MemoryRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
}

class MemoryTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(private readonly rows: Map<string, unknown>) {}

  objectStore() {
    return {
      get: (key: string) => this.request(this.rows.get(key)),
      getAll: () => this.request([...this.rows.values()]),
      put: (value: { chatId: string }) => {
        this.rows.set(value.chatId, structuredClone(value));
        this.finish();
      },
      delete: (key: string) => {
        this.rows.delete(key);
        this.finish();
      },
    };
  }

  private request<T>(result: T): MemoryRequest<T> {
    const request = new MemoryRequest<T>();
    queueMicrotask(() => {
      request.result = structuredClone(result);
      request.onsuccess?.();
      this.finish();
    });
    return request;
  }

  private finish(): void {
    setTimeout(() => this.oncomplete?.(), 0);
  }
}

const rows = new Map<string, unknown>();
const database = {
  objectStoreNames: { contains: () => true },
  transaction: () => new MemoryTransaction(rows),
  close: () => undefined,
};

beforeEach(() => {
  rows.clear();
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = new MemoryRequest<typeof database>();
      queueMicrotask(() => {
        request.result = database;
        request.onsuccess?.();
      });
      return request;
    },
    deleteDatabase: () => new MemoryRequest<undefined>(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function message(chatId: string, content: string): MessageDTO {
  return {
    id: `message-${chatId}`,
    chatId,
    role: 'assistant',
    content,
    thinking: '',
    tools: [],
    attachments: [],
    createdAt: '2026-08-12T00:00:00.000Z',
  };
}

describe('chat transcript cache', () => {
  it('stores and restores a transcript', async () => {
    const { chatCache } = await import('./chat-cache');
    await chatCache.put('chat-one', [message('chat-one', 'cached answer')]);

    expect((await chatCache.get('chat-one'))?.[0]?.content).toBe('cached answer');
  });

  it('drops an individual deleted chat', async () => {
    const { chatCache } = await import('./chat-cache');
    await chatCache.put('chat-one', [message('chat-one', 'cached answer')]);
    await chatCache.remove('chat-one');

    expect(await chatCache.get('chat-one')).toBeUndefined();
  });

  it('does not evict previously warmed chats when total text exceeds 50 MB', async () => {
    vi.spyOn(Date, 'now').mockImplementation(incrementingClock());
    useEncodedSizes();
    const { chatCache } = await import('./chat-cache');
    await chatCache.put('chat-a', [message('chat-a', 'size-20mb')]);
    await chatCache.put('chat-b', [message('chat-b', 'size-20mb')]);
    // A is now newer than B despite having been inserted first.
    await chatCache.get('chat-a');
    await chatCache.put('chat-c', [message('chat-c', 'size-20mb')]);

    expect(await chatCache.get('chat-a')).toBeDefined();
    expect(await chatCache.get('chat-b')).toBeDefined();
    expect(await chatCache.get('chat-c')).toBeDefined();
  });

  it('retains last-good data and reports an oversized snapshot', async () => {
    useEncodedSizes();
    const { chatCache } = await import('./chat-cache');
    await chatCache.put('chat-large', [message('chat-large', 'ordinary')]);
    await chatCache.put('chat-large', [message('chat-large', 'size-51mb')]);

    expect((await chatCache.get('chat-large'))?.[0]?.content).toBe('ordinary');
    expect(chatCache.storageFailed()).toBe(true);
  });

  it('degrades to no cache when IndexedDB cannot be opened', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request = new MemoryRequest<typeof database>();
        queueMicrotask(() => {
          request.error = new DOMException('denied', 'SecurityError');
          request.onerror?.();
        });
        return request;
      },
      deleteDatabase: () => new MemoryRequest<undefined>(),
    });
    const { chatCache } = await import('./chat-cache');

    await expect(chatCache.get('chat-one')).resolves.toBeUndefined();
    await expect(chatCache.put('chat-one', [message('chat-one', 'answer')])).resolves.toBeUndefined();
  });
});

function incrementingClock(): () => number {
  let now = 0;
  return () => ++now;
}

function useEncodedSizes(): void {
  class SizedTextEncoder {
    encode(value: string): Uint8Array {
      const match = /size-(\d+)mb/.exec(value);
      const byteLength = match?.[1] === undefined
        ? value.length
        : Number(match[1]) * 1024 * 1024;
      return { byteLength } as Uint8Array;
    }
  }
  vi.stubGlobal('TextEncoder', SizedTextEncoder);
}

it('reads without rewriting the stored transcript', async () => {
  const { chatCache } = await import('./chat-cache');
  await chatCache.put('read-only', [message('read-only', 'saved')]);
  const stored = rows.get('read-only');
  await chatCache.get('read-only');
  expect(rows.get('read-only')).toBe(stored);
});
it('coalesces same-turn writes and keeps deletion ordered after them', async () => {
  const { chatCache } = await import('./chat-cache');
  const first = chatCache.put('burst', [message('burst', 'first')]);
  const latest = chatCache.put('burst', [message('burst', 'latest')]);
  await Promise.all([first, latest]);
  expect((await chatCache.get('burst'))?.[0]?.content).toBe('latest');
  const pending = chatCache.put('burst', [message('burst', 'obsolete')]);
  const removed = chatCache.remove('burst');
  await Promise.all([pending, removed]);
  expect(await chatCache.get('burst')).toBeUndefined();
});
it('does not write snapshots queued before session teardown', async () => {
  const { chatCache } = await import('./chat-cache');
  const pending = chatCache.put('private', [message('private', 'secret history')]);
  chatCache.clear(); await pending; await Promise.resolve();
  expect(rows.has('private')).toBe(false);
});
