// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import type { MessageDTO, MessagesResponse } from '@pop-agent/shared';
import { useChatStore } from './chat';
import { chatsService } from '../services/chats';
vi.mock('../services/chats', () => ({ chatsService: { messages: vi.fn() } }));
vi.mock('../services/chat-cache', () => ({ chatCache: { get: vi.fn(async () => undefined), put: vi.fn(async () => {}) } }));
const row = (id: string): MessageDTO => ({ id, chatId: 'c', role: 'user', content: id, thinking: '', tools: [], attachments: [], createdAt: '2026-09-09T00:00:00Z' });
beforeEach(() => { useChatStore.getState().reset(); vi.mocked(chatsService.messages).mockReset(); });
it('does not let an older-page response revive an evicted transcript or change live state', async () => {
  useChatStore.setState({ messages: { c: [row('new')] } });
  let resolve!: (value: MessagesResponse) => void;
  vi.mocked(chatsService.messages).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const read = useChatStore.getState().loadOlder('c');
  useChatStore.setState({ messages: {} }); resolve({ messages: [row('old')] });
  await expect(read).resolves.toBeUndefined();
  expect(useChatStore.getState().messages.c).toBeUndefined();
});
it('rejects a page after cancellation and deduplicates overlapping rows', async () => {
  useChatStore.setState({ messages: { c: [row('new')] } });
  const controller = new AbortController();
  vi.mocked(chatsService.messages).mockResolvedValue({ messages: [row('old'), row('new')] });
  const cancelled = useChatStore.getState().loadOlder('c', controller.signal); controller.abort();
  await cancelled; expect(useChatStore.getState().messages.c).toEqual([row('new')]);
  await useChatStore.getState().loadOlder('c');
  expect(useChatStore.getState().messages.c).toEqual([row('old'), row('new')]);
});
it('reconciles previously opened pages instead of discarding them on refresh', async () => {
  useChatStore.setState({ messages: { c: [row('old'), row('new')] } });
  vi.mocked(chatsService.messages).mockResolvedValueOnce({ messages: [row('new')] }).mockResolvedValueOnce({ messages: [row('old')] });
  await useChatStore.getState().openChat('c');
  expect(useChatStore.getState().messages.c).toEqual([row('old'), row('new')]);
  expect(chatsService.messages).toHaveBeenCalledTimes(2);
});
