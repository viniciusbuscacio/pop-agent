// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageDTO } from '@pop-agent/shared';
import { useChatStore } from '../store/chat';
import { chatCache } from './chat-cache';
import { createContentSizer, memoryVictims, selectMemoryChat, startChatMemory } from './chat-memory';
vi.mock('./chat-cache', () => ({ chatCache: { put: vi.fn(async () => {}), get: vi.fn(async () => undefined) } }));
let stop: (() => void) | undefined;
afterEach(() => { stop?.(); useChatStore.getState().reset(); vi.clearAllMocks(); });
const message = (id: string): MessageDTO => ({ id, chatId: id, role: 'user', content: 'history', thinking: '', tools: [], attachments: [], createdAt: '2026-09-09T00:00:00Z' });
it('keeps fifteen chats and evicts the least recently visited without clearing disk or live state', () => {
  stop = startChatMemory();
  for (let n = 0; n < 15; n++) {
    const id = String(n); selectMemoryChat(id);
    useChatStore.setState(state => ({ messages: { ...state.messages, [id]: [message(id)] } }));
  }
  selectMemoryChat('0');
  selectMemoryChat('15');
  useChatStore.setState(state => ({ messages: { ...state.messages, '15': [message('15')] } }));
  expect(Object.keys(useChatStore.getState().messages)).toHaveLength(15);
  expect(useChatStore.getState().messages['0']).toBeDefined();
  expect(useChatStore.getState().messages['1']).toBeUndefined();
  expect(chatCache.put).toHaveBeenCalledWith('1', [message('1')]);
});
it('preserves queued and active chats even when they are least recent', () => {
  useChatStore.setState({ messages: Object.fromEntries(Array.from({ length: 17 }, (_, n) => [String(n), [message(String(n))]])),
    live: { '0': { runId: 'r', status: 'running', content: '', thinking: '', tools: [], seq: 0 } },
    pending: { '1': [{ id: 'q' } as never] },
  });
  selectMemoryChat('2'); stop = startChatMemory();
  expect(useChatStore.getState().messages['0']).toBeDefined();
  expect(useChatStore.getState().messages['1']).toBeDefined();
  expect(useChatStore.getState().messages['2']).toBeDefined();
  expect(useChatStore.getState().messages['3']).toBeUndefined();
  expect(useChatStore.getState().messages['4']).toBeUndefined();
});
describe('content budget', () => {
  it('enforces bytes before count and allows protected content to exceed the budget', () => {
    const entries = [{ id: 'old', used: 0, bytes: 200 * 1024 * 1024, protected: false }, { id: 'open', used: 1, bytes: 200 * 1024 * 1024, protected: true }];
    expect(memoryVictims(entries)).toEqual(['old']);
    expect(memoryVictims(entries.map(entry => ({ ...entry, protected: true })))).toEqual([]);
  });
  it('accounts for attachment strings without serializing the whole transcript', () => {
    const size = createContentSizer();
    const small = { dataUri: 'a' }; const large = { dataUri: 'a'.repeat(1000) };
    expect(size(large) - size(small)).toBe(1998);
    expect(size(large)).toBe(size(large));
  });
});
