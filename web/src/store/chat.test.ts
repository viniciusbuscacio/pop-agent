// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@popy/shared';
import { useChatStore } from './chat';

const send = vi.fn();
const stop = vi.fn();
const messagesBody: { value: unknown } = { value: { messages: [] } };

vi.mock('../services/chats', () => ({
  chatsService: {
    send: (chatId: string, text: string) => send(chatId, text) as Promise<unknown>,
    stop: (chatId: string) => stop(chatId) as Promise<unknown>,
    list: () => Promise.resolve({ chats: [] }),
    messages: () => Promise.resolve(messagesBody.value),
  },
}));

const CHAT = 'chat-000000000001';
const RUN = 'run-0000000000000001';

function apply(event: StreamEvent): void {
  useChatStore.getState().apply(event);
}

function live() {
  return useChatStore.getState().live[CHAT];
}

function messages() {
  return useChatStore.getState().messages[CHAT] ?? [];
}

beforeEach(() => {
  useChatStore.getState().reset();
  send.mockReset();
  stop.mockReset();
  send.mockResolvedValue({ runId: RUN, userMessageId: 'msg-0000000000000001' });
  messagesBody.value = { messages: [] };
});

describe('streaming into the live buffer', () => {
  beforeEach(async () => {
    await useChatStore.getState().send(CHAT, 'a question');
  });

  it('records the question immediately, before any answer arrives', () => {
    expect(messages().map((message) => message.content)).toEqual(['a question']);
    expect(live()?.runId).toBe(RUN);
  });

  it('accumulates deltas, thinking and tool output', () => {
    apply({ kind: 'thinking', chatId: CHAT, runId: RUN, seq: 1, text: 'hmm ' });
    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 2, text: 'the ' });
    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 3, text: 'answer' });
    apply({ kind: 'tool', chatId: CHAT, runId: RUN, seq: 4, name: 'bash', status: 'start', detail: 'ls' });
    apply({ kind: 'tool', chatId: CHAT, runId: RUN, seq: 5, name: 'bash', status: 'output', detail: 'a\n' });
    apply({ kind: 'tool', chatId: CHAT, runId: RUN, seq: 6, name: 'bash', status: 'output', detail: 'b\n' });

    expect(live()?.content).toBe('the answer');
    expect(live()?.thinking).toBe('hmm ');
    expect(live()?.tools).toEqual([{ name: 'bash', status: 'output', detail: 'ls' + 'a\nb\n' }]);
  });

  it('folds a tool call the way the server stores it', () => {
    apply({ kind: 'tool', chatId: CHAT, runId: RUN, seq: 1, name: 'bash', status: 'start', detail: 'echo hi\n' });
    apply({ kind: 'tool', chatId: CHAT, runId: RUN, seq: 2, name: 'bash', status: 'output', detail: 'line 1\n' });
    apply({ kind: 'tool', chatId: CHAT, runId: RUN, seq: 3, name: 'bash', status: 'done', detail: 'exit 0' });

    // Must match what run-service persists, or the same message would render
    // as one card while streaming and as three after a reload.
    expect(live()?.tools).toEqual([
      { name: 'bash', status: 'done', detail: 'echo hi\nline 1\nexit 0' },
    ]);
  });

  it('starts a new card when a second call begins', () => {
    apply({ kind: 'tool', chatId: CHAT, runId: RUN, seq: 1, name: 'bash', status: 'start', detail: 'one' });
    apply({ kind: 'tool', chatId: CHAT, runId: RUN, seq: 2, name: 'bash', status: 'done', detail: '' });
    apply({ kind: 'tool', chatId: CHAT, runId: RUN, seq: 3, name: 'bash', status: 'start', detail: 'two' });

    expect(live()?.tools).toHaveLength(2);
  });

  it('ignores fragments belonging to another run', () => {
    apply({ kind: 'delta', chatId: CHAT, runId: 'run-somebody-elses', seq: 1, text: 'not mine' });

    expect(live()?.content).toBe('');
  });

  it('promotes the buffer to a stored message when the run finishes', () => {
    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 1, text: 'done thinking' });
    apply({ kind: 'done', chatId: CHAT, runId: RUN, messageId: 'msg-0000000000000002' });

    expect(live()).toBeUndefined();
    expect(messages().map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages()[1]).toMatchObject({ id: 'msg-0000000000000002', content: 'done thinking' });
  });

  it('keeps a half-written answer when the run fails, and says so', () => {
    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 1, text: 'I was saying' });
    apply({ kind: 'error', chatId: CHAT, runId: RUN, code: 'provider_error' });

    expect(messages()[1]?.content).toBe('I was saying');
    expect(useChatStore.getState().failures[CHAT]).toBe('provider_error');
  });

  it('drops late fragments from a run that already ended', () => {
    apply({ kind: 'done', chatId: CHAT, runId: RUN, messageId: 'msg-0000000000000002' });
    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 1, text: 'too late' });

    expect(live()).toBeUndefined();
    expect(messages()).toHaveLength(1); // nothing was answered, so nothing stored
  });
});

describe('mounting mid-run', () => {
  it('seeds the live view from the server snapshot and drops what it already contains', async () => {
    // aw's partial-reply buffer: a reload mid-run starts from everything that
    // already streamed, and seq keeps the overlap from being counted twice.
    messagesBody.value = {
      messages: [],
      live: {
        runId: RUN,
        status: 'running',
        seq: 3,
        content: 'already streamed ',
        thinking: '',
        tools: [],
      },
    };
    await useChatStore.getState().openChat(CHAT);

    expect(live()?.content).toBe('already streamed ');

    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 3, text: 'duplicate' });
    expect(live()?.content).toBe('already streamed ');

    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 4, text: 'and new' });
    expect(live()?.content).toBe('already streamed and new');
  });

  it('does not resurrect a run it already saw finish', async () => {
    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 1, text: 'hello' });
    apply({ kind: 'done', chatId: CHAT, runId: RUN, messageId: 'msg-a' });

    // A stale snapshot raced the terminal event; the finished run must stay finished.
    messagesBody.value = {
      messages: [],
      live: { runId: RUN, status: 'running', seq: 1, content: 'hello', thinking: '', tools: [] },
    };
    await useChatStore.getState().openChat(CHAT);

    expect(live()).toBeUndefined();
  });
});

describe('a run started somewhere else', () => {
  it('is adopted so a second window shows the same answer', () => {
    apply({ kind: 'delta', chatId: CHAT, runId: 'run-from-the-phone', seq: 1, text: 'hello' });

    expect(live()?.runId).toBe('run-from-the-phone');
    expect(live()?.content).toBe('hello');
  });

  it('is not resurrected by a terminal event with no buffer', () => {
    apply({ kind: 'done', chatId: CHAT, runId: 'run-from-the-phone', messageId: 'msg-1' });

    expect(live()).toBeUndefined();
    expect(messages()).toHaveLength(0);
  });
});

describe('the client-side queue', () => {
  it('holds a message typed mid-run and sends it when the chat frees up', async () => {
    await useChatStore.getState().send(CHAT, 'first');
    expect(send).toHaveBeenCalledTimes(1);

    await useChatStore.getState().send(CHAT, 'second');

    expect(send, 'the second one waits').toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().queued[CHAT]).toEqual({ text: 'second', attachments: [] });

    send.mockResolvedValue({ runId: 'run-second', userMessageId: 'msg-second' });
    apply({ kind: 'done', chatId: CHAT, runId: RUN, messageId: 'msg-answer' });
    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(CHAT, 'second');
    expect(useChatStore.getState().queued[CHAT]).toBeUndefined();
  });
});

describe('run status', () => {
  it('reports a run that is waiting for a slot', async () => {
    await useChatStore.getState().send(CHAT, 'a question');

    apply({ kind: 'run-status', chatId: CHAT, runId: RUN, status: 'queued' });
    expect(live()?.status).toBe('queued');

    apply({ kind: 'run-status', chatId: CHAT, runId: RUN, status: 'running' });
    expect(live()?.status).toBe('running');
  });
});

describe('titles', () => {
  it('renames the chat in the list when the server names it', () => {
    useChatStore.setState({
      chats: [
        {
          id: CHAT,
          title: 'New chat',
          model: '',
          archived: false,
          createdAt: '',
          updatedAt: '',
          preview: '',
        },
      ],
    });

    apply({ kind: 'title', chatId: CHAT, title: 'Deploy Server' });

    expect(useChatStore.getState().chats[0]?.title).toBe('Deploy Server');
  });
});
