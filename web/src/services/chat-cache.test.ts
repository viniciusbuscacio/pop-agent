// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
});
