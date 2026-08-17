import { describe, expect, it } from 'vitest';
import type { Chat } from '../../domain/chat/chat.js';
import { SseHub, toStreamEvent } from './sse-hub.js';

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

describe('SSE broadcast', () => {
  it('delivers to every subscriber even when one connection throws', () => {
    const hub = new SseHub();
    const received: string[] = [];
    hub.subscribe(() => { throw new Error('connection closed'); });
    hub.subscribe((payload) => received.push(payload));

    hub.emit({ kind: 'local-machines-changed' });

    expect(received.map((payload) => JSON.parse(payload))).toEqual([
      { kind: 'local-machines-changed' },
    ]);
  });

  it('withholds additive events from a legacy cached client', () => {
    const hub = new SseHub();
    const legacy: string[] = [];
    const current: string[] = [];
    hub.subscribe((payload) => legacy.push(payload), 1);
    hub.subscribe((payload) => current.push(payload), 2);

    hub.emit({ kind: 'chat-archived-changed', chatId: chat.id, archived: true });
    hub.emit({ kind: 'chat-pin-changed', chatId: chat.id, pinned: true });

    expect(legacy.map((payload) => JSON.parse(payload))).toEqual([
      { kind: 'chat-pin-changed', chatId: chat.id, pinned: true },
    ]);
    expect(current.map((payload) => JSON.parse(payload))).toEqual([
      { kind: 'chat-archived-changed', chatId: chat.id, archived: true },
      { kind: 'chat-pin-changed', chatId: chat.id, pinned: true },
    ]);
  });
});

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

  it('invalidates local computer state without leaking machine details', () => {
    expect(toStreamEvent({ kind: 'local-machines-changed' })).toEqual({ kind: 'local-machines-changed' });
  });

  it('sends both pin and unpin state', () => {
    expect(toStreamEvent({ kind: 'chat-pin-changed', chatId: chat.id, pinned: true })).toEqual({
      kind: 'chat-pin-changed',
      chatId: chat.id,
      pinned: true,
    });
  });

  it('sends archive and model changes without requiring a full chat payload', () => {
    expect(toStreamEvent({
      kind: 'chat-archived-changed',
      chatId: chat.id,
      archived: true,
    })).toEqual({ kind: 'chat-archived-changed', chatId: chat.id, archived: true });
    expect(toStreamEvent({
      kind: 'chat-model-changed',
      chatId: chat.id,
      provider: 'openai-codex',
      model: 'gpt-5.6',
    })).toEqual({
      kind: 'chat-model-changed',
      chatId: chat.id,
      provider: 'openai-codex',
      model: 'gpt-5.6',
    });
  });
});
