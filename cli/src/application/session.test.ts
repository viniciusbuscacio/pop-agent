import { describe, expect, it, vi } from 'vitest';
import type { ChatDTO, StreamEvent } from '@pop-agent/shared';
import { ChatSession, type SessionListener, type SessionPorts } from './session.js';
import type { RunState } from './transcript.js';

/**
 * The screen's driver, tested with no terminal at all -- which is the reason
 * it does not know there is one.
 */

function harness(events: StreamEvent[] = []) {
  const seen: {
    runs: RunState[];
    idle: RunState[];
    queued: string[];
    steering: number;
    externalUsers: string[];
    titles: string[];
    archivedChanges: { archived: boolean; source: string }[];
    loaded: string[];
    ended: number;
  } = {
    runs: [],
    idle: [],
    queued: [],
    steering: 0,
    externalUsers: [],
    titles: [],
    archivedChanges: [],
    loaded: [],
    ended: 0,
  };
  const listener: SessionListener = {
    onChatLoaded: (chat) => seen.loaded.push(chat.id),
    onRun: (state) => seen.runs.push(state),
    onIdle: (state) => seen.idle.push(state),
    onQueued: (text) => seen.queued.push(text),
    onSteering: () => {
      seen.steering += 1;
    },
    onExternalUser: (text) => seen.externalUsers.push(text),
    onArchivedChanged: (archived, source) => seen.archivedChanges.push({ archived, source }),
    onTitle: (title) => seen.titles.push(title),
    onStreamEnd: () => {
      seen.ended += 1;
    },
  };
  // A gate the test opens: events are held until the session has a run to
  // fold them into, which is the real order too.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ports: SessionPorts = {
    createChat: vi.fn(() => Promise.resolve({ id: 'chat-1' })),
    listChats: vi.fn(() => Promise.resolve([])),
    loadChat: vi.fn(() => Promise.resolve({ messages: [] })),
    archiveChat: vi.fn(() => Promise.resolve({ ...chatDto(), archived: true })),
    unarchiveChat: vi.fn(() => Promise.resolve({ ...chatDto(), archived: false })),
    send: vi.fn(() => Promise.resolve({ runId: 'run-1' })),
    stop: vi.fn(() => Promise.resolve()),
    events: async function* () {
      await gate;
      yield* events;
    },
  };
  return { seen, session: new ChatSession(ports, listener), ports, release: () => release() };
}

const delta = (text: string, seq: number): StreamEvent => ({
  kind: 'delta',
  chatId: 'chat-1',
  runId: 'run-1',
  seq,
  text,
});

const chatDto = (id = 'chat-1'): ChatDTO => ({
  id,
  title: 'Loaded conversation',
  model: '',
  provider: '',
  archived: false,
  pinned: false,
  createdAt: '',
  updatedAt: '',
  preview: '',
});

describe('ChatSession', () => {
  it('reports a server-queued turn without inventing a run id', async () => {
    const { session, ports, seen } = harness();
    vi.mocked(ports.send).mockResolvedValueOnce({
      queued: true,
      message: {
        id: 'queued-1',
        chatId: 'chat-1',
        text: 'wait behind phone',
        attachments: [],
        filePaths: [],
        createdAt: '',
        updatedAt: '',
      },
    });

    await session.ask('wait behind phone');

    expect(seen.queued).toEqual(['wait behind phone']);
    expect(session.busy).toBe(false);
  });

  it('creates a chat on the first question and keeps it for the next', async () => {
    const { session, ports } = harness();
    await session.ask('first');
    await session.ask('second');

    expect(ports.createChat).toHaveBeenCalledTimes(1);
    expect(session.currentChatId).toBe('chat-1');
  });

  it('opens on an existing chat without creating one', async () => {
    const { session, ports } = harness();
    session.open('chat-9');
    await session.ask('hello');

    expect(ports.createChat).not.toHaveBeenCalled();
    expect(ports.send).toHaveBeenCalledWith('chat-9', 'hello');
  });

  it('clears the selected chat and live run when opening a new conversation', async () => {
    const { session } = harness();
    await session.ask('first');
    expect(session.busy).toBe(true);

    session.open(undefined);

    expect(session.currentChatId).toBeUndefined();
    expect(session.busy).toBe(false);
  });

  it('archives an idle persisted chat and returns to an unpersisted session without creating an empty chat', async () => {
    const { session, ports } = harness();
    session.open('chat-existing');

    expect(await session.archiveCurrent()).toBe('archived');

    expect(ports.archiveChat).toHaveBeenCalledWith('chat-existing');
    expect(ports.createChat).not.toHaveBeenCalled();
    expect(session.currentChatId).toBeUndefined();
    expect(session.busy).toBe(false);
  });

  it('does not make a request when there is no current persisted chat', async () => {
    const { session, ports } = harness();

    expect(await session.archiveCurrent()).toBe('no-chat');

    expect(ports.archiveChat).not.toHaveBeenCalled();
    expect(ports.createChat).not.toHaveBeenCalled();
  });

  it('refuses to archive while the current answer is running', async () => {
    const { session, ports } = harness();
    await session.ask('still running');

    expect(await session.archiveCurrent()).toBe('busy');

    expect(ports.archiveChat).not.toHaveBeenCalled();
    expect(session.currentChatId).toBe('chat-1');
    expect(session.busy).toBe(true);
  });

  it('refuses to archive while a send request is still being accepted', async () => {
    const { session, ports } = harness();
    session.open('chat-existing');
    let finishSend: (response: { runId: string }) => void = () => undefined;
    vi.mocked(ports.send).mockImplementationOnce(
      () => new Promise((resolve) => {
        finishSend = resolve;
      }),
    );

    const asking = session.ask('not accepted yet');
    await vi.waitFor(() => expect(ports.send).toHaveBeenCalledOnce());

    expect(await session.archiveCurrent()).toBe('busy');
    expect(ports.archiveChat).not.toHaveBeenCalled();

    finishSend({ runId: 'run-1' });
    await asking;
  });

  it('preserves the current chat when archiving fails', async () => {
    const { session, ports } = harness();
    session.open('chat-existing');
    vi.mocked(ports.archiveChat).mockRejectedValueOnce(new Error('Archive failed.'));

    await expect(session.archiveCurrent()).rejects.toThrow('Archive failed.');

    expect(session.currentChatId).toBe('chat-existing');
    expect(session.busy).toBe(false);
  });

  it('makes only the current transcript read-only on archive events and reenables it on restore', async () => {
    const { session, ports, seen, release } = harness([
      { kind: 'chat-archived-changed', chatId: 'chat-other', archived: true },
      { kind: 'chat-archived-changed', chatId: 'chat-1', archived: true },
      { kind: 'chat-archived-changed', chatId: 'chat-1', archived: true },
      { kind: 'chat-archived-changed', chatId: 'chat-1', archived: false },
    ]);
    session.open('chat-1');

    const listening = session.listen();
    release();
    await listening;

    expect(session.currentChatId).toBe('chat-1');
    expect(session.readOnly).toBe(false);
    expect(seen.archivedChanges).toEqual([
      { archived: true, source: 'event' },
      { archived: false, source: 'event' },
    ]);
    await session.ask('enabled again');
    expect(ports.send).toHaveBeenCalledWith('chat-1', 'enabled again');
  });

  it('blocks a known archived chat before sending', async () => {
    const { session, ports, release } = harness([
      { kind: 'chat-archived-changed', chatId: 'chat-1', archived: true },
    ]);
    session.open('chat-1');
    const listening = session.listen();
    release();
    await listening;

    await expect(session.ask('keep this draft')).rejects.toMatchObject({ code: 'chat_archived' });
    expect(ports.send).not.toHaveBeenCalled();
    expect(session.busy).toBe(false);
  });

  it('converges to read-only when an unknown archived chat rejects a send', async () => {
    const { session, ports, seen } = harness();
    session.open('chat-archived');
    vi.mocked(ports.send).mockRejectedValueOnce(Object.assign(new Error('Archived.'), {
      code: 'chat_archived',
    }));

    await expect(session.ask('unsent draft')).rejects.toMatchObject({ code: 'chat_archived' });

    expect(session.readOnly).toBe(true);
    expect(session.busy).toBe(false);
    expect(seen.runs).toEqual([]);
    expect(seen.archivedChanges).toEqual([{ archived: true, source: 'send-rejected' }]);
    await expect(session.ask('still unsent')).rejects.toMatchObject({ code: 'chat_archived' });
    expect(ports.send).toHaveBeenCalledTimes(1);
  });

  it('unarchives in place and reenables sends', async () => {
    const { session, ports } = harness();
    await session.switchTo({ ...chatDto('chat-archived'), archived: true });

    expect(await session.unarchiveCurrent()).toBe('unarchived');

    expect(ports.unarchiveChat).toHaveBeenCalledWith('chat-archived');
    expect(session.currentChatId).toBe('chat-archived');
    expect(session.readOnly).toBe(false);
    await session.ask('works again');
    expect(ports.send).toHaveBeenCalledWith('chat-archived', 'works again');
  });

  it('does not request an unnecessary restore without an archived current chat', async () => {
    const { session, ports } = harness();
    expect(await session.unarchiveCurrent()).toBe('no-chat');
    await session.switchTo(chatDto('chat-open'));
    expect(await session.unarchiveCurrent()).toBe('not-archived');
    expect(ports.unarchiveChat).not.toHaveBeenCalled();
  });

  it('keeps an archived transcript read-only when restore fails', async () => {
    const { session, ports } = harness();
    await session.switchTo({ ...chatDto('chat-archived'), archived: true });
    vi.mocked(ports.unarchiveChat).mockRejectedValueOnce(new Error('Restore failed.'));

    await expect(session.unarchiveCurrent()).rejects.toThrow('Restore failed.');

    expect(session.currentChatId).toBe('chat-archived');
    expect(session.readOnly).toBe(true);
  });

  it('does not overwrite a newer archive event with a late restore response', async () => {
    const { session, ports } = harness();
    await session.switchTo({ ...chatDto('chat-archived'), archived: true });
    let finishRestore: (chat: ChatDTO) => void = () => undefined;
    vi.mocked(ports.unarchiveChat).mockImplementationOnce(
      () => new Promise((resolve) => {
        finishRestore = resolve;
      }),
    );

    const restoring = session.unarchiveCurrent();
    await vi.waitFor(() => expect(ports.unarchiveChat).toHaveBeenCalledOnce());
    (session as unknown as { absorb(event: StreamEvent): void }).absorb({
      kind: 'chat-archived-changed', chatId: 'chat-archived', archived: true,
    });
    finishRestore({ ...chatDto('chat-archived'), archived: false });

    expect(await restoring).toBe('superseded');
    expect(session.readOnly).toBe(true);
  });

  it('ignores a late archived-send refusal after navigation', async () => {
    const { session, ports, seen } = harness();
    session.open('chat-old');
    let rejectSend: (error: Error) => void = () => undefined;
    vi.mocked(ports.send).mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        rejectSend = reject;
      }),
    );

    const asking = session.ask('draft for old chat');
    await vi.waitFor(() => expect(ports.send).toHaveBeenCalledOnce());
    session.open('chat-new');
    rejectSend(Object.assign(new Error('Archived.'), { code: 'chat_archived' }));
    await asking;

    expect(session.currentChatId).toBe('chat-new');
    expect(session.readOnly).toBe(false);
    expect(seen.archivedChanges).toEqual([]);
  });

  it('does not let a late archive completion clear a newer selection', async () => {
    const { session, ports } = harness();
    session.open('chat-existing');
    let finishArchive: (chat: ChatDTO) => void = () => undefined;
    vi.mocked(ports.archiveChat).mockImplementationOnce(
      () => new Promise((resolve) => {
        finishArchive = resolve;
      }),
    );

    const archiving = session.archiveCurrent();
    await vi.waitFor(() => expect(ports.archiveChat).toHaveBeenCalledOnce());
    session.open('chat-newer');
    finishArchive({ ...chatDto('chat-existing'), archived: true });

    expect(await archiving).toBe('superseded');
    expect(session.currentChatId).toBe('chat-newer');
  });

  it('does not restore an abandoned run from a late send response', async () => {
    const { session, ports, seen } = harness();
    let finishSend: (response: { runId: string }) => void = () => undefined;
    vi.mocked(ports.send).mockImplementationOnce(
      () => new Promise((resolve) => {
        finishSend = resolve;
      }),
    );
    const asking = session.ask('first');
    await vi.waitFor(() => expect(ports.send).toHaveBeenCalledOnce());

    session.open(undefined);
    finishSend({ runId: 'run-1' });
    await asking;

    expect(session.currentChatId).toBeUndefined();
    expect(session.busy).toBe(false);
    expect(seen.runs).toEqual([]);
  });

  it('loads stored history and seeds the live run when switching chats', async () => {
    const { session, ports, seen } = harness();
    vi.mocked(ports.loadChat).mockResolvedValueOnce({
      messages: [
        {
          id: 'stored-user',
          chatId: 'chat-1',
          role: 'user',
          content: 'Earlier question',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
      ],
      live: {
        runId: 'run-1',
        status: 'running',
        seq: 4,
        content: 'Partial answer',
        thinking: '',
        tools: [],
      },
    });

    await session.switchTo(chatDto());

    expect(session.currentChatId).toBe('chat-1');
    expect(seen.loaded).toEqual(['chat-1']);
    expect(seen.runs.at(-1)).toMatchObject({ text: 'Partial answer', status: 'running' });
  });

  it('replays destination events over the loaded snapshot without duplicating overlap', async () => {
    const { session, ports, seen, release } = harness([
      delta('overlap', 4),
      delta(' and newer', 5),
    ]);
    let finishLoad: (response: Awaited<ReturnType<SessionPorts['loadChat']>>) => void = () => undefined;
    vi.mocked(ports.loadChat).mockImplementationOnce(
      () => new Promise((resolve) => {
        finishLoad = resolve;
      }),
    );

    const switching = session.switchTo(chatDto());
    const listening = session.listen();
    release();
    await listening;
    finishLoad({
      messages: [],
      live: {
        runId: 'run-1',
        status: 'running',
        seq: 4,
        content: 'snapshot',
        thinking: '',
        tools: [],
      },
    });
    await switching;

    expect(seen.runs.at(-1)?.text).toBe('snapshot and newer');
  });

  it('reports the answer as it grows and once when it settles', async () => {
    const { session, seen, release } = harness([
      delta('Hel', 0),
      delta('lo', 1),
      { kind: 'done', chatId: 'chat-1', runId: 'run-1', messageId: 'm' },
    ]);
    const listening = session.listen();
    await session.ask('hi');
    release();
    await listening;

    expect(seen.runs.at(-1)?.text).toBe('Hello');
    // Exactly one idle: a screen that swapped the streamed text for rendered
    // markdown twice would print the answer twice.
    expect(seen.idle).toHaveLength(1);
  });

  it('keeps the same run and starts a new segment when steering is delivered', async () => {
    const { session, seen, release } = harness([
      delta('before', 0),
      {
        kind: 'steering-delivered',
        chatId: 'chat-1',
        runId: 'run-1',
        seq: 0,
        assistant: {
          id: 'assistant-before',
          chatId: 'chat-1',
          role: 'assistant',
          content: 'before',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
        user: {
          id: 'user-steering',
          chatId: 'chat-1',
          role: 'user',
          content: 'change course',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
      },
      delta('after', 1),
      { kind: 'done', chatId: 'chat-1', runId: 'run-1', messageId: 'm' },
    ]);
    const listening = session.listen();
    await session.ask('hi');
    release();
    await listening;

    expect(seen.steering).toBe(1);
    expect(seen.runs.map((state) => state.text)).toContain('');
    expect(seen.idle.at(-1)).toMatchObject({ runId: 'run-1', text: 'after' });
  });

  it('adopts a run started on another client in the open chat', async () => {
    const { session, seen, release } = harness([
      {
        kind: 'run-started',
        chatId: 'chat-1',
        runId: 'run-from-web',
        user: {
          id: 'user-from-web',
          chatId: 'chat-1',
          role: 'user',
          content: 'sent from the web',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
      },
      { kind: 'delta', chatId: 'chat-1', runId: 'run-from-web', seq: 1, text: 'shared answer' },
      { kind: 'done', chatId: 'chat-1', runId: 'run-from-web', messageId: 'answer-from-web' },
    ]);
    session.open('chat-1');
    const listening = session.listen();
    release();
    await listening;

    expect(seen.externalUsers).toEqual(['sent from the web']);
    expect(seen.idle.at(-1)).toMatchObject({ runId: 'run-from-web', text: 'shared answer' });
  });

  it('does not print its own turn twice when SSE beats the send response', async () => {
    const { session, ports, seen, release } = harness([
      {
        kind: 'run-started',
        chatId: 'chat-1',
        runId: 'run-1',
        user: {
          id: 'own-user',
          chatId: 'chat-1',
          role: 'user',
          content: 'my question',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
      },
    ]);
    let answerSend: (response: { runId: string; userMessageId: string }) => void = () => undefined;
    vi.mocked(ports.send).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerSend = resolve;
        }),
    );

    const listening = session.listen();
    const asking = session.ask('my question');
    await Promise.resolve();
    release();
    await listening;
    answerSend({ runId: 'run-1', userMessageId: 'own-user' });
    await asking;

    expect(seen.externalUsers).toEqual([]);
    expect(seen.runs).toHaveLength(1);
  });

  it('does not print its own durable follow-up twice when it starts later', async () => {
    const { session, ports, seen, release } = harness([
      {
        kind: 'run-started',
        chatId: 'chat-1',
        runId: 'run-follow-up',
        user: {
          id: 'follow-up-user',
          chatId: 'chat-1',
          role: 'user',
          content: 'do this next',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
      },
    ]);
    session.open('chat-1');
    vi.mocked(ports.send).mockResolvedValueOnce({
      queued: true,
      message: {
        id: 'queued-follow-up',
        chatId: 'chat-1',
        text: 'do this next',
        attachments: [],
        filePaths: [],
        createdAt: '',
        updatedAt: '',
      },
    });
    await session.ask('do this next');

    const listening = session.listen();
    release();
    await listening;

    expect(seen.externalUsers).toEqual([]);
    expect(seen.runs.at(-1)?.runId).toBe('run-follow-up');
  });

  it('ignores a run started in a different chat', async () => {
    const { session, seen, release } = harness([
      {
        kind: 'run-started',
        chatId: 'chat-2',
        runId: 'run-elsewhere',
        user: {
          id: 'user-elsewhere',
          chatId: 'chat-2',
          role: 'user',
          content: 'not this screen',
          thinking: '',
          tools: [],
          attachments: [],
          createdAt: '',
        },
      },
    ]);
    session.open('chat-1');
    const listening = session.listen();
    release();
    await listening;

    expect(seen.externalUsers).toEqual([]);
    expect(seen.runs).toEqual([]);
  });

  it('is busy until the run ends', async () => {
    const { session, release } = harness([
      delta('working', 0),
      { kind: 'done', chatId: 'chat-1', runId: 'run-1', messageId: 'm' },
    ]);
    const listening = session.listen();
    await session.ask('hi');
    expect(session.busy).toBe(true);

    release();
    await listening;
    expect(session.busy).toBe(false);
  });

  it('passes the title on, which belongs to the chat and not to a run', async () => {
    const { session, seen, release } = harness([{ kind: 'title', chatId: 'chat-1', title: 'Naming' }]);
    const listening = session.listen();
    await session.ask('hi');
    release();
    await listening;

    expect(seen.titles).toEqual(['Naming']);
  });

  it('says the stream ended rather than pretending to still be live', async () => {
    const { session, seen, release } = harness([]);
    const listening = session.listen();
    release();
    await listening;

    expect(seen.ended).toBe(1);
  });

  it('does not ask the server to stop a run that is not running', async () => {
    const { session, ports } = harness();
    session.open('chat-1');
    await session.stop();
    expect(ports.stop).not.toHaveBeenCalled();
  });
});

describe('resume snapshot races', () => {
  it('does not resurrect a completed run from buffered pre-snapshot events', async () => {
    const user = {
      id: 'stored-user', chatId: 'chat-1', role: 'user' as const, content: 'Already answered',
      thinking: '', tools: [], attachments: [], createdAt: '',
    };
    const { session, ports, seen, release } = harness([
      { kind: 'run-started', chatId: 'chat-1', runId: 'old-run', user },
      { kind: 'delta', chatId: 'chat-1', runId: 'old-run', seq: 1, text: 'Old answer' },
    ]);
    vi.mocked(ports.loadChat).mockResolvedValue({ messages: [user] });
    await session.switchTo(chatDto('chat-1'));
    const listening = session.listen();
    release();
    await listening;
    expect(seen.externalUsers).toEqual([]);
    expect(seen.runs).toEqual([]);
    expect(session.busy).toBe(false);
  });

  it('keeps the selected chat when an earlier create-chat request resolves late', async () => {
    const { session, ports } = harness();
    let created: (chat: { id: string }) => void = () => undefined;
    vi.mocked(ports.createChat).mockImplementation(() => new Promise((resolve) => { created = resolve; }));
    const asking = session.ask('Sent before switching');
    await session.switchTo(chatDto('selected'));
    created({ id: 'late-created' });
    await asking;
    expect(session.currentChatId).toBe('selected');
    expect(ports.send).not.toHaveBeenCalled();
  });
});
