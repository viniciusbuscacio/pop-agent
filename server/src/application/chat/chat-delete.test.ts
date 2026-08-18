import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../../infrastructure/db/sqlite-chat-repo.js';
import { SqliteRunJournalRepo } from '../../infrastructure/db/sqlite-run-journal-repo.js';
import type { Chat } from '../../domain/chat/chat.js';
import type { AgentBridge, AgentRunRequest, AgentRunResult } from '../ports/agent-bridge.js';
import type { ChatPurger } from '../ports/chat-purger.js';
import type { Clock } from '../ports/clock.js';
import type { EventSink, RunEvent } from '../ports/event-sink.js';
import { ChatService } from './chat-service.js';
import { RunService } from './run-service.js';

/**
 * Deleting a conversation kills its work (docs/specs/Spec-Pop-General.md §6). The order is the
 * whole point, so the order is what this asserts: the abort reaches the bridge
 * *before* the first row is deleted. A delete that removed the rows first
 * would leave a pi process group running, spending the user's own credit, on
 * an answer nobody can ever read.
 */

const NOW = 1_700_000_000_000;

class FixedClock implements Clock {
  now(): number {
    return NOW;
  }
}

class SilentSink implements EventSink {
  readonly events: RunEvent[] = [];
  emit(event: RunEvent): void {
    this.events.push(event);
    if (event.kind === 'chat-deleted') log.push('notify');
  }
}

/** Everything that happened, in the order it happened. */
let log: string[];

/** The real repository, plus a note in the log when a chat is deleted. */
class LoggingChatRepo extends SqliteChatRepo {
  override delete(id: string): void {
    log.push('delete');
    super.delete(id);
  }
}

/** A bridge that hangs until the run is aborted, like a real one mid-answer. */
class HangingBridge implements AgentBridge {
  complete(): Promise<{ text: string }> {
    return Promise.resolve({ text: 'scripted' });
  }

  discardSession(): void {
    // The script keeps no sessions to forget.
  }
  // Declared first: a field initializer that ran after the constructor body
  // would put the no-op back and the test would wait forever.
  private begin: () => void = () => undefined;
  readonly started: Promise<void>;

  constructor() {
    this.started = new Promise<void>((resolve) => {
      this.begin = resolve;
    });
  }

  run(request: AgentRunRequest): Promise<AgentRunResult> {
    request.onEvent({ kind: 'delta', text: 'half an answer' });
    this.begin();
    return new Promise<AgentRunResult>((resolve) => {
      request.signal.addEventListener(
        'abort',
        () => {
          log.push('abort');
          request.onEvent({ kind: 'error', code: 'aborted' });
          resolve({});
        },
        { once: true },
      );
    });
  }

  listModels(): Promise<{ id: string }[]> {
    return Promise.resolve([{ id: 'fake/model-1' }]);
  }
}

let db: Database.Database;
let repo: SqliteChatRepo;
let bridge: HangingBridge;
let runs: RunService;
let chats: ChatService;
let purged: string[];
let sink: SilentSink;

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  log = [];
  purged = [];

  repo = new LoggingChatRepo(db);

  const purger: ChatPurger = {
    purge: (chat: Chat) => {
      log.push('purge');
      purged.push(chat.id);
    },
  };

  bridge = new HangingBridge();
  sink = new SilentSink();
  runs = new RunService({ chats: repo, journal: new SqliteRunJournalRepo(db), bridge, sink: new SilentSink(), clock: new FixedClock() });
  chats = new ChatService({ chats: repo, clock: new FixedClock(), runs, purger, sink });
});

describe('deleting a chat with a run in flight', () => {
  it('aborts before it deletes, then purges', async () => {
    const chat = chats.create();
    const started = runs.startRun(chat.id, 'take your time');
    expect(started.ok).toBe(true);
    await bridge.started;

    expect(chats.delete(chat.id)).toBe(true);

    expect(log).toEqual(['abort', 'delete', 'notify', 'purge']);
    expect(purged).toEqual([chat.id]);

    // The aborted run unwinds afterwards and must not write into rows that no
    // longer exist -- a foreign-key failure here would be an unhandled
    // rejection inside the run loop.
    await runs.whenIdle();
    expect(repo.get(chat.id)).toBeUndefined();
  });

  it('drops a queued run for the chat without ever reaching the engine', async () => {
    // A ceiling of one: the second chat's run can only wait.
    const single = new RunService({
      chats: repo,
      journal: new SqliteRunJournalRepo(db),
      bridge,
      sink: new SilentSink(),
      clock: new FixedClock(),
      maxConcurrentRuns: 1,
    });
    const service = new ChatService({ chats: repo, clock: new FixedClock(), runs: single });

    const busy = service.create();
    const waiting = service.create();
    single.startRun(busy.id, 'first');
    await bridge.started;
    const queued = single.startRun(waiting.id, 'second');
    expect(queued.ok).toBe(true);

    expect(service.delete(waiting.id)).toBe(true);

    // Nothing is left in flight for it, and the run never became a live one.
    expect(single.liveRun(waiting.id)).toBeUndefined();
    expect(single.stopRun(waiting.id)).toBe(false);
  });

  it('deleting an idle chat still purges, and says false for one that is gone', () => {
    const chat = chats.create();

    expect(chats.delete(chat.id)).toBe(true);
    expect(log).toEqual(['delete', 'notify', 'purge']);
    expect(chats.delete(chat.id)).toBe(false);
  });

  it('broadcasts the complete durable chat when it is created', () => {
    const chat = chats.create();

    expect(sink.events.at(-1)).toEqual({ kind: 'chat-created', chatId: chat.id, chat });
  });

  it('broadcasts a later manual or task title for the newly created chat', () => {
    const chat = chats.create();

    chats.rename(chat.id, 'Morning briefing');

    expect(sink.events.at(-1)).toEqual({
      kind: 'title',
      chatId: chat.id,
      title: 'Morning briefing',
    });
  });

  it('persists and broadcasts the synchronized execution mode', () => {
    const chat = chats.create();

    expect(chats.setExecutionMode(chat.id, 'plan')?.executionMode).toBe('plan');
    expect(repo.get(chat.id)?.executionMode).toBe('plan');
    expect(sink.events.at(-1)).toEqual({
      kind: 'chat-execution-mode-changed',
      chatId: chat.id,
      executionMode: 'plan',
    });
  });

  it('persists pin and unpin before broadcasting the resulting state', () => {
    const chat = chats.create();

    expect(chats.setPinned(chat.id, true)?.pinned).toBe(true);
    expect(repo.get(chat.id)?.pinned).toBe(true);
    expect(sink.events.at(-1)).toEqual({
      kind: 'chat-pin-changed',
      chatId: chat.id,
      pinned: true,
    });

    expect(chats.setPinned(chat.id, false)?.pinned).toBe(false);
    expect(repo.get(chat.id)?.pinned).toBe(false);
    expect(sink.events.at(-1)).toEqual({
      kind: 'chat-pin-changed',
      chatId: chat.id,
      pinned: false,
    });
  });
});
