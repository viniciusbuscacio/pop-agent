// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@pop-agent/shared';
import { useChatStore } from './chat';

const send = vi.fn();
const stop = vi.fn();
const updateQueue = vi.fn();
const cancelQueue = vi.fn();
const patch = vi.fn();
const archiveOthers = vi.fn();
const messagesBody: { value: unknown } = { value: { messages: [] } };
// What the server would answer after any patch: the two lists, post-change.
const listBody: { active: unknown[]; archived: unknown[] } = { active: [], archived: [] };

vi.mock('../services/chats', () => ({
  chatsService: {
    send: (chatId: string, text: string) => send(chatId, text) as Promise<unknown>,
    stop: (chatId: string) => stop(chatId) as Promise<unknown>,
    updateQueue: (chatId: string, messageId: string, text: string) =>
      updateQueue(chatId, messageId, text) as Promise<unknown>,
    cancelQueue: (chatId: string, messageId: string) =>
      cancelQueue(chatId, messageId) as Promise<unknown>,
    patch: (chatId: string, body: unknown) => patch(chatId, body) as Promise<unknown>,
    archiveOthers: (keepChatId: string) => archiveOthers(keepChatId) as Promise<unknown>,
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

function queuedMessage(text: string, id = 'queued-00000000001') {
  return {
    id,
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
  archiveOthers.mockReset();
  patch.mockResolvedValue({});
  archiveOthers.mockResolvedValue({ archived: 0 });
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
  it('adds its user turn and adopts the run before fragments arrive', () => {
    apply({
      kind: 'run-started',
      chatId: CHAT,
      runId: 'run-from-the-phone',
      user: {
        id: 'message-from-the-phone',
        chatId: CHAT,
        role: 'user',
        content: 'sent on the phone',
        thinking: '',
        tools: [],
        attachments: [],
        createdAt: '2026-08-09T00:00:00.000Z',
      },
    });

    expect(messages().at(-1)).toMatchObject({
      id: 'message-from-the-phone',
      content: 'sent on the phone',
    });
    expect(live()).toMatchObject({ runId: 'run-from-the-phone', status: 'queued' });
  });

  it('does not duplicate its own user turn when SSE beats the POST response', async () => {
    let answerSend: (response: { runId: string; userMessageId: string }) => void = () => undefined;
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerSend = resolve;
        }),
    );
    const sending = useChatStore.getState().send(CHAT, 'my question');
    await Promise.resolve();

    apply({
      kind: 'run-started',
      chatId: CHAT,
      runId: RUN,
      user: {
        id: 'my-user-message',
        chatId: CHAT,
        role: 'user',
        content: 'my question',
        thinking: '',
        tools: [],
        attachments: [],
        createdAt: '2026-08-09T00:00:00.000Z',
      },
    });
    answerSend({ runId: RUN, userMessageId: 'my-user-message' });
    await sending;

    expect(messages().filter((message) => message.id === 'my-user-message')).toHaveLength(1);
  });

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
  it('appends every accepted pending message in FIFO order', async () => {
    await useChatStore.getState().send(CHAT, 'first');
    send.mockResolvedValueOnce({ queued: true, message: queuedMessage('second', 'queued-2') });
    send.mockResolvedValueOnce({ queued: true, message: queuedMessage('third', 'queued-3') });

    await useChatStore.getState().send(CHAT, 'second');
    await useChatStore.getState().send(CHAT, 'third');

    expect(useChatStore.getState().pending[CHAT]?.map((item) => item.text)).toEqual([
      'second',
      'third',
    ]);
  });

  it('loads the authoritative FIFO with the chat snapshot on another device', async () => {
    messagesBody.value = {
      messages: [],
      live: { runId: RUN, status: 'running', seq: 0, content: '', thinking: '', tools: [] },
      pending: [queuedMessage('from phone', 'queued-1'), queuedMessage('then this', 'queued-2')],
    };

    await useChatStore.getState().openChat(CHAT);

    expect(useChatStore.getState().pending[CHAT]?.map((item) => item.text)).toEqual([
      'from phone',
      'then this',
    ]);
  });

  it('synchronizes incremental queue additions, edits and removals over SSE', () => {
    const first = queuedMessage('first', 'queued-1');
    const second = queuedMessage('second', 'queued-2');
    apply({ kind: 'queue', chatId: CHAT, message: first, change: { kind: 'upsert', message: first } });
    apply({ kind: 'queue', chatId: CHAT, message: first, change: { kind: 'upsert', message: second } });
    apply({
      kind: 'queue',
      chatId: CHAT,
      message: first,
      change: { kind: 'upsert', message: { ...second, text: 'edited elsewhere' } },
    });
    expect(useChatStore.getState().pending[CHAT]?.map((item) => item.text)).toEqual([
      'first',
      'edited elsewhere',
    ]);

    apply({ kind: 'queue', chatId: CHAT, message: second, change: { kind: 'remove', id: first.id } });
    expect(useChatStore.getState().pending[CHAT]?.map((item) => item.id)).toEqual([second.id]);
  });

  it('shows the queued user bubble when the server starts it and keeps the next item', () => {
    const first = queuedMessage('second', 'queued-2');
    const next = queuedMessage('third', 'queued-3');
    useChatStore.setState({ pending: { [CHAT]: [first, next] } });

    apply({
      kind: 'queue',
      chatId: CHAT,
      message: next,
      change: { kind: 'remove', id: first.id },
      started: {
        runId: 'run-second',
        userMessageId: 'message-second',
        text: 'second',
        attachments: [],
        createdAt: '2026-08-09T00:00:01.000Z',
      },
    });

    expect(useChatStore.getState().pending[CHAT]?.map((item) => item.id)).toEqual([next.id]);
    expect(messages().at(-1)).toMatchObject({ id: 'message-second', content: 'second' });
    expect(live()?.runId).toBe('run-second');
  });

  it('does not hide the next item when steering is delivered', async () => {
    await useChatStore.getState().send(CHAT, 'first');
    apply({ kind: 'delta', chatId: CHAT, runId: RUN, seq: 1, text: 'before' });
    const next = queuedMessage('next direction', 'queued-next');
    useChatStore.setState({ pending: { [CHAT]: [next] } });

    apply({
      kind: 'steering-delivered',
      chatId: CHAT,
      runId: RUN,
      seq: 1,
      assistant: {
        id: 'assistant-before', chatId: CHAT, role: 'assistant', content: 'before',
        thinking: '', tools: [], attachments: [], createdAt: '2026-08-09T00:00:01.000Z',
      },
      user: {
        id: 'user-steering', chatId: CHAT, role: 'user', content: 'change course',
        thinking: '', tools: [], attachments: [], createdAt: '2026-08-09T00:00:01.000Z',
      },
    });

    expect(useChatStore.getState().pending[CHAT]).toEqual([next]);
    expect(messages().slice(-2).map((message) => message.content)).toEqual(['before', 'change course']);
  });

  it('edits and cancels a specific pending item through server endpoints', async () => {
    const original = queuedMessage('old', 'queued-2');
    useChatStore.setState({ pending: { [CHAT]: [original] } });
    updateQueue.mockResolvedValueOnce({ message: { ...original, text: 'edited' } });

    await useChatStore.getState().updateQueued(CHAT, original.id, 'edited');
    expect(updateQueue).toHaveBeenCalledWith(CHAT, original.id, 'edited');
    expect(useChatStore.getState().pending[CHAT]?.[0]?.text).toBe('edited');

    await useChatStore.getState().cancelQueued(CHAT, original.id);
    expect(cancelQueue).toHaveBeenCalledWith(CHAT, original.id);
    expect(useChatStore.getState().pending[CHAT]).toBeUndefined();
  });

  it('does not discard a different legacy message when the FIFO is occupied', async () => {
    localStorage.setItem(
      `pop-agent.queued.${CHAT}`,
      JSON.stringify({ text: 'older local message', attachments: [], filePaths: [] }),
    );
    messagesBody.value = { messages: [], pending: [queuedMessage('already on server')] };

    await useChatStore.getState().openChat(CHAT);

    expect(useChatStore.getState().pending[CHAT]?.[0]?.text).toBe('already on server');
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
    expect(useChatStore.getState().pending[CHAT]?.[0]?.text).toBe('legacy');
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
          pinned: false,
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
    pinned: false,
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

  it('archives all others in one call and reconciles both lists', async () => {
    const other = { ...chat, id: 'chat-000000000002', title: 'Other' };
    useChatStore.setState({ chats: [chat, other], messages: { [other.id]: [] } });
    listBody.active = [chat];
    listBody.archived = [{ ...other, archived: true }];
    archiveOthers.mockResolvedValue({ archived: 1 });

    const count = await useChatStore.getState().archiveOthers(CHAT);

    expect(archiveOthers).toHaveBeenCalledWith(CHAT);
    expect(count).toBe(1);
    expect(useChatStore.getState().chats.map((entry) => entry.id)).toEqual([CHAT]);
    expect(useChatStore.getState().archived.map((entry) => entry.id)).toEqual([other.id]);
    // Archiving is not deletion: a still-running answer or loaded history may
    // remain useful if the user opens the archived chat from search.
    expect(useChatStore.getState().messages[other.id]).toEqual([]);
  });
});
