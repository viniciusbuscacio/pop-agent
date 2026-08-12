import { describe, expect, it } from 'vitest';
import type { Chat } from '../../domain/chat/chat.js';
import { toStreamEvent } from './sse-hub.js';

const chat: Chat = {
  id: 'chat-lifecycle',
  title: 'Chat 1',
  model: '',
  provider: '',
  archived: false,
  pinned: false,
  piSessionId: '',
  summary: '',
  autoTitle: true,
  createdAt: '2026-08-10T12:00:00.000Z',
  updatedAt: '2026-08-10T12:00:00.000Z',
};

describe('chat lifecycle events on the SSE wire', () => {
  it('sends a complete list-ready chat when one is created', () => {
    expect(toStreamEvent({ kind: 'chat-created', chatId: chat.id, chat })).toEqual({
      kind: 'chat-created',
      chatId: chat.id,
      chat: {
        id: chat.id,
        title: chat.title,
        model: '',
        provider: '',
        archived: false,
        pinned: false,
        createdAt: chat.createdAt,
        updatedAt: chat.updatedAt,
        preview: '',
      },
    });
  });

  it('sends the deleted id without extra state', () => {
    expect(toStreamEvent({ kind: 'chat-deleted', chatId: chat.id })).toEqual({
      kind: 'chat-deleted',
      chatId: chat.id,
    });
  });
});
