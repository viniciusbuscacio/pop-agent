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
  executionMode: 'normal',
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
        executionMode: 'normal',
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

  it('carries the durable answer and its model attribution on completion', () => {
    const message = {
      id: 'message-answer',
      chatId: chat.id,
      role: 'assistant' as const,
      content: 'answer',
      thinking: '',
      tools: [],
      attachments: [],
      createdAt: '2026-08-10T12:00:01.000Z',
      responseModel: { providerId: 'openai-codex', modelId: 'gpt-5.6-sol' },
    };

    expect(
      toStreamEvent({
        kind: 'done',
        chatId: chat.id,
        runId: 'run-answer',
        messageId: message.id,
        message,
      }),
    ).toEqual({
      kind: 'done',
      chatId: chat.id,
      runId: 'run-answer',
      messageId: message.id,
      message,
    });
  });

  it('sends execution mode changes', () => {
    expect(toStreamEvent({
      kind: 'chat-execution-mode-changed',
      chatId: chat.id,
      executionMode: 'plan',
    })).toEqual({
      kind: 'chat-execution-mode-changed',
      chatId: chat.id,
      executionMode: 'plan',
    });
  });

  it('sends both pin and unpin state', () => {
    expect(toStreamEvent({ kind: 'chat-pin-changed', chatId: chat.id, pinned: true })).toEqual({
      kind: 'chat-pin-changed',
      chatId: chat.id,
      pinned: true,
    });
  });
});
