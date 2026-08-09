// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@pop-agent/shared';
import { useChatStore } from './chat';

const send = vi.fn();
const stop = vi.fn();
const updateQueue = vi.fn();
const cancelQueue = vi.fn();
const patch = vi.fn();
const messagesBody: { value: unknown } = { value: { messages: [] } };
// What the server would answer after any patch: the two lists, post-change.
const listBody: { active: unknown[]; archived: unknown[] } = { active: [], archived: [] };

vi.mock('../services/chats', () => ({
  chatsService: {
    send: (chatId: string, text: string) => send(chatId, text) as Promise<unknown>,
    stop: (chatId: string) => stop(chatId) as Promise<unknown>,
    updateQueue: (chatId: string, text: string) => updateQueue(chatId, text) as Promise<unknown>,
    cancelQueue: (chatId: string) => cancelQueue(chatId) as Promise<unknown>,
    patch: (chatId: string, body: unknown) => patch(chatId, body) as Promise<unknown>,
    list: (archived = false) =>
      Promise.resolve({ chats: archived ? listBody.archived : listBody.active }),
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

function queuedMessage(text: string) {
  return {
    id: 'queued-00000000001',
    chatId: CHAT,
    text,
    deliveryMode: 'steer' as const,
    attachments: [],
    filePaths: [],
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:00.000Z',
  };
}

beforeEach(() => {
  useChatStore.getState().reset();
  send.mockReset();
  stop.mockReset();
  updateQueue.mockReset();
  cancelQueue.mockReset();
  patch.mockReset();
  patch.mockResolvedValue({});
  send.mockResolvedValue({ runId: RUN, userMessageId: 'msg-0000000000000001' });
  updateQueue.mockResolvedValue({ message: queuedMessage('edited') });
  cancelQueue.mockResolvedValue(undefined);
  messagesBody.value = { messages: [] };
  listBody.active = [];
  listBody.archived = [];
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

describe('stopping a run', () => {
  it('clears the composer even when the terminal SSE event is missed', async () => {
    await useChatStore.getState().send(CHAT, 'stop me');
    stop.mockResolvedValue({ stopped: true });

    await useChatStore.getState().stop(CHAT);

    expect(stop).toHaveBeenCalledWith(CHAT);
    expect(live()).toBeUndefined();
    expect(messages().at(-1)?.content).toBe('You stopped this answer.');
  });

  it('does not synthesize a stop when the server had nothing to stop', async () => {
    stop.mockResolvedValue({ stopped: false });

    await useChatStore.getState().stop(CHAT);

    expect(live()).toBeUndefined();
    expect(messages()).toHaveLength(0);
  });

  it('reconciles a run the server no longer knows (a restart) as interrupted', async () => {
    // The tab thinks a run is live, but the server restarted while we were
    // connected: its process is gone, so stop answers `false`. The composer
    // must still stop showing Stop, and the interruption must be marked.
    await useChatStore.getState().send(CHAT, 'was running when it restarted');
    stop.mockResolvedValue({ stopped: false });

    await useChatStore.getState().stop(CHAT);

    expect(live()).toBeUndefined();
    expect(messages().at(-1)?.content).toBe(
      'This answer was interrupted — the server may have restarted.',
    );
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

  it('clears a run this tab still thought was live when the server reports none', async () => {
    // A run streamed here, then the server ended it while we were disconnected
    // (a restart). On reconnect openChat refetches: no live run, so the stale
    // spinner must go instead of hanging forever.
    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 1, text: 'half an answer' });
    expect(live()?.runId).toBe(RUN);

    messagesBody.value = { messages: [], live: undefined };
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

describe('the server-side queue', () => {
  it('accepts the server decision to queue instead of posting again after done', async () => {
    await useChatStore.getState().send(CHAT, 'first');
    send.mockResolvedValueOnce({ queued: true, message: queuedMessage('second') });

    await useChatStore.getState().send(CHAT, 'second');
    apply({ kind: 'done', chatId: CHAT, runId: RUN, messageId: 'msg-answer' });
    await Promise.resolve();

    expect(send).toHaveBeenCalledTimes(2);
    expect(useChatStore.getState().queued[CHAT]?.text).toBe('second');
  });

  it('loads the authoritative queue with the chat snapshot on another device', async () => {
    messagesBody.value = {
      messages: [],
      live: { runId: RUN, status: 'running', seq: 0, content: '', thinking: '', tools: [] },
      queued: queuedMessage('from the phone'),
    };

    await useChatStore.getState().openChat(CHAT);

    expect(useChatStore.getState().queued[CHAT]?.text).toBe('from the phone');
  });

  it('synchronizes queue edits and consumption over SSE', () => {
    apply({ kind: 'queue', chatId: CHAT, message: queuedMessage('edited elsewhere') });
    expect(useChatStore.getState().queued[CHAT]?.text).toBe('edited elsewhere');

    apply({ kind: 'queue', chatId: CHAT });
    expect(useChatStore.getState().queued[CHAT]).toBeUndefined();
  });

  it('shows the queued user bubble when the server starts it', () => {
    useChatStore.setState({ queued: { [CHAT]: queuedMessage('second') } });

    apply({
      kind: 'queue',
      chatId: CHAT,
      started: {
        runId: 'run-second',
        userMessageId: 'message-second',
        text: 'second',
        attachments: [],
        createdAt: '2026-08-09T00:00:01.000Z',
      },
    });

    expect(useChatStore.getState().queued[CHAT]).toBeUndefined();
    expect(messages().at(-1)).toMatchObject({ id: 'message-second', content: 'second' });
    expect(live()?.runId).toBe('run-second');
  });

  it('splits the live assistant bubble when pi consumes a steering message', async () => {
    await useChatStore.getState().send(CHAT, 'first');
    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 1, text: 'before' });
    useChatStore.setState({ queued: { [CHAT]: queuedMessage('change course') } });

    apply({
      kind: 'steering-delivered',
      chatId: CHAT,
      runId: RUN,
      seq: 1,
      assistant: {
        id: 'assistant-before',
        chatId: CHAT,
        role: 'assistant',
        content: 'before',
        thinking: '',
        tools: [],
        attachments: [],
        createdAt: '2026-08-09T00:00:01.000Z',
      },
      user: {
        id: 'user-steering',
        chatId: CHAT,
        role: 'user',
        content: 'change course',
        thinking: '',
        tools: [],
        attachments: [],
        createdAt: '2026-08-09T00:00:01.000Z',
      },
    });
    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 2, text: 'after' });

    expect(messages().slice(-2).map((message) => message.content)).toEqual([
      'before',
      'change course',
    ]);
    expect(live()).toMatchObject({ runId: RUN, seq: 2, content: 'after' });
    expect(useChatStore.getState().queued[CHAT]).toBeUndefined();
  });

  it('edits and cancels through server endpoints', async () => {
    useChatStore.setState({ queued: { [CHAT]: queuedMessage('old') } });

    await useChatStore.getState().updateQueued(CHAT, 'edited');
    expect(updateQueue).toHaveBeenCalledWith(CHAT, 'edited');
    expect(useChatStore.getState().queued[CHAT]?.text).toBe('edited');

    await useChatStore.getState().cancelQueued(CHAT);
    expect(cancelQueue).toHaveBeenCalledWith(CHAT);
    expect(useChatStore.getState().queued[CHAT]).toBeUndefined();
  });

  it('does not discard a different legacy message when the server slot is occupied', async () => {
    localStorage.setItem(
      `pop-agent.queued.${CHAT}`,
      JSON.stringify({ text: 'older local message', attachments: [], filePaths: [] }),
    );
    messagesBody.value = { messages: [], queued: queuedMessage('already on server') };

    await useChatStore.getState().openChat(CHAT);

    expect(useChatStore.getState().queued[CHAT]?.text).toBe('already on server');
    expect(localStorage.getItem(`pop-agent.queued.${CHAT}`)).toContain('older local message');
    expect(send).not.toHaveBeenCalled();
  });

  it('migrates a queue left by the previous PWA version exactly once', async () => {
    localStorage.setItem(
      `pop-agent.queued.${CHAT}`,
      JSON.stringify({ text: 'legacy', attachments: [], filePaths: [] }),
    );
    send.mockResolvedValueOnce({ queued: true, message: queuedMessage('legacy') });
    messagesBody.value = {
      messages: [],
      live: { runId: RUN, status: 'running', seq: 0, content: '', thinking: '', tools: [] },
    };

    await useChatStore.getState().openChat(CHAT);

    expect(send).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().queued[CHAT]?.text).toBe('legacy');
    expect(localStorage.getItem(`pop-agent.queued.${CHAT}`)).toBeNull();
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
          provider: '',
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

describe('archiving', () => {
  const chat = {
    id: CHAT,
    title: 'A chat',
    model: '',
    provider: '',
    archived: false,
    createdAt: '',
    updatedAt: '',
    preview: '',
  };

  it('archive moves the chat from the main list to the archived one', async () => {
    useChatStore.setState({ chats: [chat] });
    listBody.active = [];
    listBody.archived = [{ ...chat, archived: true }];

    await useChatStore.getState().setArchived(CHAT, true);

    expect(patch).toHaveBeenCalledWith(CHAT, { archived: true });
    expect(useChatStore.getState().chats).toEqual([]);
    expect(useChatStore.getState().archived.map((entry) => entry.id)).toEqual([CHAT]);
  });

  it('unarchive puts the chat back in the main list without a reload', async () => {
    useChatStore.setState({ archived: [{ ...chat, archived: true }] });
    listBody.active = [chat];
    listBody.archived = [];

    await useChatStore.getState().setArchived(CHAT, false);

    expect(useChatStore.getState().chats.map((entry) => entry.id)).toEqual([CHAT]);
    expect(useChatStore.getState().archived).toEqual([]);
  });
});
