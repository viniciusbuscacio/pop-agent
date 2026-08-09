import { describe, expect, it, vi } from 'vitest';
import type { StreamEvent } from '@pop-agent/shared';
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
    titles: string[];
    ended: number;
  } = {
    runs: [],
    idle: [],
    queued: [],
    steering: 0,
    titles: [],
    ended: 0,
  };
  const listener: SessionListener = {
    onRun: (state) => seen.runs.push(state),
    onIdle: (state) => seen.idle.push(state),
    onQueued: (text) => seen.queued.push(text),
    onSteering: () => {
      seen.steering += 1;
    },
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
