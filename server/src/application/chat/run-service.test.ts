import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../../infrastructure/db/sqlite-chat-repo.js';
import { SqliteLlmRunsRepo } from '../../infrastructure/db/sqlite-llm-runs-repo.js';
import type { AgentBridge, AgentRunRequest, AgentRunResult } from '../ports/agent-bridge.js';
import type { Clock } from '../ports/clock.js';
import type { EventSink, RunEvent } from '../ports/event-sink.js';
import { ChatService } from './chat-service.js';
import { RunService } from './run-service.js';

/**
 * The real repository over an in-memory database: the orchestration is worth
 * testing against actual persistence, since half of what it does is decide
 * what gets stored.
 */

const NOW = 1_700_000_000_000;

class FixedClock implements Clock {
  private value = NOW;
  now(): number {
    return (this.value += 1000);
  }
}

class RecordingSink implements EventSink {
  readonly events: RunEvent[] = [];
  emit(event: RunEvent): void {
    this.events.push(event);
  }
  kinds(): string[] {
    return this.events.map((event) => event.kind);
  }
  of<K extends RunEvent['kind']>(kind: K): Extract<RunEvent, { kind: K }>[] {
    return this.events.filter((event) => event.kind === kind) as Extract<RunEvent, { kind: K }>[];
  }
}

/** A bridge the test drives by hand. */
class ScriptedBridge implements AgentBridge {
  script: (request: AgentRunRequest) => Promise<void> = async (request) => {
    request.onEvent({ kind: 'delta', text: 'hello' });
    await Promise.resolve();
  };
  usage: AgentRunResult['usage'];
  readonly seen: AgentRunRequest[] = [];

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.seen.push(request);
    await this.script(request);
    return this.usage === undefined ? {} : { usage: this.usage };
  }

  listModels(): Promise<{ id: string }[]> {
    return Promise.resolve([{ id: 'fake/model-1' }]);
  }
}

let db: Database.Database;
let repo: SqliteChatRepo;
let chats: ChatService;
let runs: RunService;
let sink: RecordingSink;
let bridge: ScriptedBridge;

function newChat(): string {
  return chats.create().id;
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  repo = new SqliteChatRepo(db);
  const clock = new FixedClock();
  chats = new ChatService({ chats: repo, clock });
  sink = new RecordingSink();
  bridge = new ScriptedBridge();
  runs = new RunService({ chats: repo, bridge, sink, clock, llmRuns: new SqliteLlmRunsRepo(db) });
});

describe('starting a run', () => {
  it('stores the user message and answers immediately with ids', () => {
    const chatId = newChat();

    const result = runs.startRun(chatId, 'hello there');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.runId).toMatch(/^run-/);
    const stored = repo.getMessages(chatId, { limit: 10 });
    expect(stored[0]?.role).toBe('user');
    expect(stored[0]?.content).toBe('hello there');
    expect(stored[0]?.id).toBe(result.userMessageId);
  });

  it('refuses a chat that does not exist', () => {
    expect(runs.startRun('chat-000000000000', 'hi')).toEqual({
      ok: false,
      reason: 'chat_not_found',
    });
  });

  it('allows only one run per chat', () => {
    const chatId = newChat();
    bridge.script = () => new Promise(() => undefined); // never resolves

    runs.startRun(chatId, 'first');

    expect(runs.startRun(chatId, 'second')).toEqual({ ok: false, reason: 'run_in_progress' });
  });

  it('lets a different chat run at the same time', () => {
    bridge.script = () => new Promise(() => undefined);
    const first = newChat();
    const second = newChat();

    runs.startRun(first, 'one');

    expect(runs.startRun(second, 'two').ok).toBe(true);
  });
});

describe('finishing a run', () => {
  it('stores the assembled answer and reports its id', async () => {
    const chatId = newChat();
    bridge.script = (request) => {
      request.onEvent({ kind: 'thinking', text: 'let me think' });
      request.onEvent({ kind: 'delta', text: 'the ' });
      request.onEvent({ kind: 'delta', text: 'answer' });
      request.onEvent({ kind: 'tool', name: 'bash', status: 'done', detail: 'echo hi' });
      return Promise.resolve();
    };

    runs.startRun(chatId, 'question');
    await runs.whenIdle();

    const done = sink.of('done')[0];
    expect(done).toBeDefined();

    const messages = repo.getMessages(chatId, { limit: 10 });
    const answer = messages[messages.length - 1];
    expect(answer?.id).toBe(done?.messageId);
    expect(answer?.role).toBe('assistant');
    expect(answer?.content).toBe('the answer');
    expect(answer?.thinking).toBe('let me think');
    expect(answer?.tools).toEqual([{ name: 'bash', status: 'done', detail: 'echo hi' }]);
  });

  it('stores one record per tool call, not one per event', async () => {
    const chatId = newChat();
    bridge.script = (request) => {
      request.onEvent({ kind: 'tool', name: 'bash', status: 'start', detail: 'echo hi\n' });
      request.onEvent({ kind: 'tool', name: 'bash', status: 'output', detail: 'line 1\n' });
      request.onEvent({ kind: 'tool', name: 'bash', status: 'output', detail: 'line 2\n' });
      request.onEvent({ kind: 'tool', name: 'bash', status: 'done', detail: 'exit 0' });
      return Promise.resolve();
    };

    runs.startRun(chatId, 'question');
    await runs.whenIdle();

    const messages = repo.getMessages(chatId, { limit: 10 });
    const answer = messages[messages.length - 1];
    // One call happened, so one card should render -- before and after reload.
    expect(answer?.tools).toEqual([
      { name: 'bash', status: 'done', detail: 'echo hi\nline 1\nline 2\nexit 0' },
    ]);
  });

  it('keeps two separate calls separate', async () => {
    const chatId = newChat();
    bridge.script = (request) => {
      request.onEvent({ kind: 'tool', name: 'bash', status: 'start', detail: 'one' });
      request.onEvent({ kind: 'tool', name: 'bash', status: 'done', detail: '' });
      request.onEvent({ kind: 'tool', name: 'bash', status: 'start', detail: 'two' });
      request.onEvent({ kind: 'tool', name: 'bash', status: 'done', detail: '' });
      return Promise.resolve();
    };

    runs.startRun(chatId, 'question');
    await runs.whenIdle();

    const messages = repo.getMessages(chatId, { limit: 10 });
    expect(messages[messages.length - 1]?.tools).toHaveLength(2);
  });

  it('broadcasts every fragment as it arrives', async () => {
    bridge.script = (request) => {
      request.onEvent({ kind: 'delta', text: 'a' });
      request.onEvent({ kind: 'delta', text: 'b' });
      return Promise.resolve();
    };

    runs.startRun(newChat(), 'question');
    await runs.whenIdle();

    expect(sink.kinds()).toEqual(['title', 'run-status', 'delta', 'delta', 'done']);
  });

  it('keeps the half-written answer when the run fails', async () => {
    const chatId = newChat();
    bridge.script = (request) => {
      request.onEvent({ kind: 'delta', text: 'I was saying' });
      request.onEvent({ kind: 'error', code: 'provider_error' });
      return Promise.resolve();
    };

    runs.startRun(chatId, 'question');
    await runs.whenIdle();

    expect(sink.of('error')[0]?.code).toBe('provider_error');
    expect(sink.of('done')).toHaveLength(0);
    const messages = repo.getMessages(chatId, { limit: 10 });
    expect(messages[messages.length - 1]?.content).toBe('I was saying');
  });

  it('stores nothing when a run fails before saying anything', async () => {
    const chatId = newChat();
    bridge.script = (request) => {
      request.onEvent({ kind: 'error', code: 'provider_error' });
      return Promise.resolve();
    };

    runs.startRun(chatId, 'question');
    await runs.whenIdle();

    expect(repo.getMessages(chatId, { limit: 10 })).toHaveLength(1); // just the user's
  });

  it('treats a thrown adapter as a failed run rather than a crash', async () => {
    bridge.script = () => Promise.reject(new Error('boom'));

    runs.startRun(newChat(), 'question');
    await runs.whenIdle();

    expect(sink.of('error')[0]?.code).toBe('operation_error');
  });

  it('frees the chat once it is over', async () => {
    const chatId = newChat();

    runs.startRun(chatId, 'first');
    await runs.whenIdle();

    expect(runs.startRun(chatId, 'second').ok).toBe(true);
  });
});

describe('stopping a run', () => {
  it('aborts the engine and keeps what had arrived', async () => {
    const chatId = newChat();
    bridge.script = (request) =>
      new Promise((resolve) => {
        request.onEvent({ kind: 'delta', text: 'partial' });
        request.signal.addEventListener('abort', () => {
          request.onEvent({ kind: 'error', code: 'aborted' });
          resolve();
        });
      });

    runs.startRun(chatId, 'slow question');
    expect(runs.stopRun(chatId)).toBe(true);
    await runs.whenIdle();

    expect(sink.of('error')[0]?.code).toBe('aborted');
    const messages = repo.getMessages(chatId, { limit: 10 });
    expect(messages[messages.length - 1]?.content).toBe('partial');
  });

  it('reports nothing to stop when the chat is idle', () => {
    expect(runs.stopRun(newChat())).toBe(false);
  });
});

describe('the queue', () => {
  beforeEach(() => {
    const clock = new FixedClock();
    runs = new RunService({ chats: repo, bridge, sink, clock, maxConcurrentRuns: 2 });
  });

  it('holds runs past the ceiling and reports them as queued', () => {
    bridge.script = () => new Promise(() => undefined);
    const ids = [newChat(), newChat(), newChat()];

    for (const [index, chatId] of ids.entries()) {
      expect(runs.startRun(chatId, `question ${String(index)}`).ok).toBe(true);
    }

    const statuses = sink.of('run-status');
    expect(statuses.filter((event) => event.status === 'running')).toHaveLength(2);
    expect(statuses.filter((event) => event.status === 'queued')).toHaveLength(1);
    expect(bridge.seen).toHaveLength(2);
  });

  it('starts a queued run as soon as a slot frees up', async () => {
    const release: (() => void)[] = [];
    bridge.script = () => new Promise<void>((resolve) => release.push(resolve));
    const ids = [newChat(), newChat(), newChat()];
    for (const chatId of ids) runs.startRun(chatId, 'question');

    expect(bridge.seen).toHaveLength(2);
    release[0]?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(bridge.seen).toHaveLength(3);
    const third = sink.of('run-status').filter((event) => event.status === 'running');
    expect(third).toHaveLength(3);
  });

  it('drops a queued run from the queue instead of aborting the engine', () => {
    bridge.script = () => new Promise(() => undefined);
    const ids = [newChat(), newChat(), newChat()];
    for (const chatId of ids) runs.startRun(chatId, 'question');

    const queuedChat = ids[2] as string;
    expect(runs.stopRun(queuedChat)).toBe(true);

    expect(bridge.seen).toHaveLength(2); // it never reached the engine
    expect(sink.of('error')[0]).toMatchObject({ chatId: queuedChat, code: 'aborted' });
    expect(runs.startRun(queuedChat, 'again').ok).toBe(true);
  });
});

describe('automatic titles', () => {
  it('names a new chat after its first message', async () => {
    const chatId = newChat();

    runs.startRun(chatId, 'help me plan the grocery shopping');
    await runs.whenIdle();

    expect(repo.get(chatId)?.title).toBe('Help Plan Grocery Shopping');
    expect(sink.of('title')[0]?.title).toBe('Help Plan Grocery Shopping');
  });

  it('only titles once', async () => {
    const chatId = newChat();

    runs.startRun(chatId, 'first message about deployment');
    await runs.whenIdle();
    runs.startRun(chatId, 'a completely different subject now');
    await runs.whenIdle();

    expect(sink.of('title')).toHaveLength(1);
    expect(repo.get(chatId)?.title).toBe('First Message About Deployment');
  });

  it('leaves a title the user chose alone', async () => {
    const chatId = newChat();
    chats.rename(chatId, 'My own title');

    runs.startRun(chatId, 'something else entirely');
    await runs.whenIdle();

    expect(repo.get(chatId)?.title).toBe('My own title');
    expect(sink.of('title')).toHaveLength(0);
  });

  it('does not produce two chats with the same name', async () => {
    const first = newChat();
    runs.startRun(first, 'deploy the server');
    await runs.whenIdle();

    const second = newChat();
    runs.startRun(second, 'deploy the server');
    await runs.whenIdle();

    expect(repo.get(second)?.title).toBe('Deploy Server 2');
  });
});

describe('accounting', () => {
  const USAGE = {
    provider: 'openrouter',
    model: 'moonshotai/kimi-k3',
    inputTokens: 400,
    outputTokens: 60,
    cost: 0.0021,
  };

  it('books what the bridge says the run cost', async () => {
    const chatId = newChat();
    bridge.usage = USAGE;

    const started = runs.startRun(chatId, 'how much is this costing?');
    await runs.whenIdle();

    const rows = db.prepare('SELECT * FROM llm_runs').all() as {
      id: string;
      chat_id: string;
      provider: string;
      model: string;
      tokens_in: number;
      tokens_out: number;
      cost: number;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(started.ok ? started.runId : '');
    expect(rows[0]?.chat_id).toBe(chatId);
    expect(rows[0]?.provider).toBe('openrouter');
    expect(rows[0]?.model).toBe('moonshotai/kimi-k3');
    expect(rows[0]?.tokens_in).toBe(400);
    expect(rows[0]?.tokens_out).toBe(60);
    expect(rows[0]?.cost).toBeCloseTo(0.0021, 10);
  });

  it('books a failed run that still reached the model', async () => {
    // pi bills every model call, including the ones inside a run that ended
    // badly -- the record has to say so.
    const chatId = newChat();
    bridge.usage = USAGE;
    bridge.script = async (request) => {
      request.onEvent({ kind: 'error', code: 'provider_error' });
      await Promise.resolve();
    };

    runs.startRun(chatId, 'doomed');
    await runs.whenIdle();

    expect(db.prepare('SELECT count(*) AS total FROM llm_runs').get()).toEqual({ total: 1 });
  });

  it('books nothing when the engine was never reached', async () => {
    const chatId = newChat();
    bridge.usage = undefined;

    runs.startRun(chatId, 'no provider configured');
    await runs.whenIdle();

    expect(db.prepare('SELECT count(*) AS total FROM llm_runs').get()).toEqual({ total: 0 });
  });
});

describe('the live snapshot', () => {
  it('hands a mounting client everything that already streamed', () => {
    // aw's partial-reply buffer: a reload mid-run must not open on a blank
    // bubble when half the answer has already gone out over the stream.
    const chatId = newChat();
    let finish: (() => void) | undefined;
    bridge.script = (request) => {
      request.onEvent({ kind: 'thinking', text: 'hmm ' });
      request.onEvent({ kind: 'delta', text: 'so far' });
      request.onEvent({ kind: 'tool', name: 'bash', status: 'start', detail: 'ls\n' });
      return new Promise((resolve) => {
        finish = resolve;
      });
    };

    runs.startRun(chatId, 'question');

    const snapshot = runs.liveRun(chatId);
    expect(snapshot?.status).toBe('running');
    expect(snapshot?.seq).toBe(3);
    expect(snapshot?.thinking).toBe('hmm ');
    expect(snapshot?.content).toBe('so far');
    expect(snapshot?.tools).toEqual([{ name: 'bash', status: 'start', detail: 'ls\n' }]);

    finish?.();
  });

  it('is gone once the run is over', async () => {
    const chatId = newChat();

    runs.startRun(chatId, 'question');
    await runs.whenIdle();

    expect(runs.liveRun(chatId)).toBeUndefined();
  });

  it('numbers the emitted fragments so the snapshot and the stream agree', async () => {
    const chatId = newChat();
    bridge.script = (request) => {
      request.onEvent({ kind: 'delta', text: 'a' });
      request.onEvent({ kind: 'delta', text: 'b' });
      return Promise.resolve();
    };

    runs.startRun(chatId, 'question');
    await runs.whenIdle();

    expect(sink.of('delta').map((event) => event.seq)).toEqual([1, 2]);
  });
});

describe('confirmation of a risky action', () => {
  it('emits a confirm card and unblocks when the user allows', async () => {
    const chatId = newChat();
    let decision: boolean | undefined;
    bridge.script = async (request) => {
      // The bridge asks mid-run; the run waits on the answer.
      decision = await request.confirm?.({ action: 'run a destructive command', detail: 'rm -rf x' });
      request.onEvent({ kind: 'delta', text: 'done' });
    };

    const started = runs.startRun(chatId, 'do the thing');
    // Let the run reach the confirm await.
    await Promise.resolve();
    await Promise.resolve();

    const card = sink.of('confirm')[0];
    expect(card).toBeDefined();
    expect(card?.action).toBe('run a destructive command');

    const runId = started.ok ? started.runId : '';
    expect(runs.resolveConfirm(chatId, runId, true)).toBe(true);
    await runs.whenIdle();

    expect(decision).toBe(true);
  });

  it('denies on its own after the timeout', async () => {
    runs = new RunService({
      chats: repo,
      bridge,
      sink,
      clock: new FixedClock(),
      confirmTimeoutMs: 10,
    });
    const chatId = newChat();
    let decision: boolean | undefined;
    bridge.script = async (request) => {
      decision = await request.confirm?.({ action: 'run a destructive command', detail: 'rm -rf x' });
    };

    runs.startRun(chatId, 'do it');
    await runs.whenIdle();

    expect(decision).toBe(false);
  });

  it('answers false when there is nothing pending', () => {
    const chatId = newChat();
    expect(runs.resolveConfirm(chatId, 'run-nope', true)).toBe(false);
  });
});

describe('a process shutdown mid-run', () => {
  it('parks the partial answer on disk, marked as interrupted', () => {
    const chatId = newChat();
    bridge.script = (request) => {
      request.onEvent({ kind: 'delta', text: 'half an answer' });
      return new Promise(() => undefined); // the process dies before this resolves
    };
    runs.startRun(chatId, 'a question');

    runs.flushInterrupted();

    const stored = repo.getMessages(chatId, { limit: 10 });
    const assistant = stored.find((message) => message.role === 'assistant');
    expect(assistant?.content).toContain('half an answer');
    expect(assistant?.content).toContain('interrupted by a server restart');
  });

  it('stores nothing for a run that had not streamed a word', () => {
    const chatId = newChat();
    bridge.script = () => new Promise(() => undefined);
    runs.startRun(chatId, 'a question');

    runs.flushInterrupted();

    const stored = repo.getMessages(chatId, { limit: 10 });
    expect(stored.some((message) => message.role === 'assistant')).toBe(false);
  });

  it('never stores the same words twice if the run still finishes', () => {
    const chatId = newChat();
    bridge.script = (request) => {
      request.onEvent({ kind: 'delta', text: 'half an answer' });
      return new Promise(() => undefined);
    };
    runs.startRun(chatId, 'a question');

    runs.flushInterrupted();
    runs.flushInterrupted(); // a second signal must be a no-op

    const stored = repo.getMessages(chatId, { limit: 10 });
    expect(stored.filter((message) => message.role === 'assistant')).toHaveLength(1);
  });
});
