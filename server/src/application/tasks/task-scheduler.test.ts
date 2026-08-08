import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../../infrastructure/db/sqlite-chat-repo.js';
import { SqliteTaskRepo } from '../../infrastructure/db/sqlite-task-repo.js';
import type { AgentBridge, AgentRunRequest, AgentRunResult } from '../ports/agent-bridge.js';
import type { Clock } from '../ports/clock.js';
import type { MaintenanceJob } from '../ports/maintenance-job.js';
import type { EventSink, RunEvent } from '../ports/event-sink.js';
import type { Timer } from '../ports/timer.js';
import { ChatService } from '../chat/chat-service.js';
import { RunService } from '../chat/run-service.js';
import { TaskScheduler } from './task-scheduler.js';
import { TaskService } from './task-service.js';

/**
 * The scheduler against real persistence and a bridge the test drives. Time
 * only moves when a test moves it, and the tick is pulled by hand -- nothing
 * here waits for a wall-clock second.
 */

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

class MovableClock implements Clock {
  value = NOW;
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

class SilentSink implements EventSink {
  readonly events: RunEvent[] = [];
  emit(event: RunEvent): void {
    this.events.push(event);
  }
}

/** Records every prompt it is handed, and answers however the test says. */
class ScriptedBridge implements AgentBridge {
  complete(): Promise<{ text: string }> {
    return Promise.resolve({ text: 'scripted' });
  }

  discardSession(): void {
    // The script keeps no sessions to forget.
  }
  readonly prompts: string[] = [];
  /** Runs in flight, so a test can hold one open and let another queue up. */
  script: (request: AgentRunRequest) => Promise<void> = (request) => {
    request.onEvent({ kind: 'delta', text: 'done' });
    return Promise.resolve();
  };

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    this.prompts.push(request.prompt);
    await this.script(request);
    return {};
  }

  listModels(): Promise<{ id: string }[]> {
    return Promise.resolve([{ id: 'fake/model-1' }]);
  }
}

let db: Database.Database;
let clock: MovableClock;
let bridge: ScriptedBridge;
let chatRepo: SqliteChatRepo;
let taskRepo: SqliteTaskRepo;
let chats: ChatService;
let runs: RunService;
let tasks: TaskService;
let scheduler: TaskScheduler;
let journal: string[];

/** A timer the test fires by hand: `tick()` is what the real one would call. */
class FakeTimer implements Timer {
  fire: (() => void) | undefined;
  everyMs: number | undefined;
  stops = 0;

  every(ms: number, fn: () => void): () => void {
    this.everyMs = ms;
    this.fire = fn;
    return () => {
      this.stops += 1;
    };
  }
}

let timer: FakeTimer;
/** What the run service asked the outside world to announce, per finished run. */
let announced: { chatId: string; notify: boolean }[];

function build(jobs: MaintenanceJob[] = []): void {
  scheduler = new TaskScheduler({
    tasks: taskRepo,
    chats,
    runs,
    clock,
    timer,
    jobs,
    onJournal: (line) => journal.push(line),
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  clock = new MovableClock();
  bridge = new ScriptedBridge();
  chatRepo = new SqliteChatRepo(db);
  taskRepo = new SqliteTaskRepo(db);
  announced = [];
  runs = new RunService({
    chats: chatRepo,
    bridge,
    sink: new SilentSink(),
    clock,
    notifyDone: (info) => announced.push({ chatId: info.chatId, notify: info.notify }),
  });
  chats = new ChatService({ chats: chatRepo, clock });
  tasks = new TaskService({ tasks: taskRepo, clock });
  timer = new FakeTimer();
  journal = [];
  build();
});

describe('a due task', () => {
  it('opens a chat named after the task and runs its prompt through the pipeline', async () => {
    const task = tasks.create({ title: 'Morning briefing', prompt: 'What happened overnight?', scheduleKind: 'once' });

    await scheduler.tick();

    expect(bridge.prompts).toEqual(['What happened overnight?']);
    const stored = taskRepo.get(task.id);
    expect(stored?.lastStatus).toBe('ok');
    expect(stored?.lastRunAt).toBe(NOW);
    expect(stored?.lastChatId).toBeDefined();

    const chat = chatRepo.get(stored?.lastChatId ?? '');
    expect(chat?.title).toBe('Morning briefing');
    // The rename is the manual path: the LLM must never rewrite this name.
    expect(chat?.autoTitle).toBe(false);

    const messages = chatRepo.getMessages(chat?.id ?? '', { limit: 10 });
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[0]?.content).toBe('What happened overnight?');
  });

  it('leaves a non-generic title alone even when it looks like a starter', async () => {
    // "Chat 4" is what isGenericTitle() matches; the manual-rename flag is
    // what actually protects the name, and it must win.
    tasks.create({ title: 'Chat 4', prompt: 'hello', scheduleKind: 'once' });

    await scheduler.tick();

    expect(chatRepo.list({ archived: false })[0]?.title).toBe('Chat 4');
  });

  it('switches a once task off and parks an interval task one interval later', async () => {
    const once = tasks.create({ title: 'Once', prompt: 'a', scheduleKind: 'once' });
    const every = tasks.create({
      title: 'Every ten',
      prompt: 'b',
      scheduleKind: 'interval',
      intervalMinutes: 10,
    });
    // The interval task is parked ten minutes out; move there so both are due.
    clock.advance(10 * MINUTE);

    await scheduler.tick();

    expect(taskRepo.get(once.id)?.enabled).toBe(false);
    const repeated = taskRepo.get(every.id);
    expect(repeated?.enabled).toBe(true);
    expect(repeated?.nextRunAt).toBe(NOW + 10 * MINUTE + 10 * MINUTE);
  });

  it('is not picked up again while it is still running', async () => {
    tasks.create({ title: 'Slow', prompt: 'a', scheduleKind: 'interval', intervalMinutes: 1 });
    clock.advance(MINUTE);

    let release = (): void => undefined;
    bridge.script = () => new Promise<void>((resolve) => (release = resolve));

    const first = scheduler.tick();
    // A second tick lands while the first run is still in the bridge.
    await scheduler.tick();
    release();
    await first;
    await scheduler.whenIdle();

    expect(bridge.prompts).toHaveLength(1);
  });
});

describe('what happens when a run finishes', () => {
  it('announces the run by default, so an ordinary task still reaches the phone', async () => {
    tasks.create({ title: 'Briefing', prompt: 'a', scheduleKind: 'once' });

    await scheduler.tick();

    expect(announced).toHaveLength(1);
    expect(announced[0]?.notify).toBe(true);
  });

  it('runs quietly when the task asked not to be notified', async () => {
    tasks.create({
      title: 'Every ten minutes',
      prompt: 'a',
      scheduleKind: 'interval',
      intervalMinutes: 10,
      notifyOnFinish: false,
    });
    clock.advance(10 * MINUTE);

    await scheduler.tick();

    // Still a finished run the health service must see -- only the push is off.
    expect(announced).toHaveLength(1);
    expect(announced[0]?.notify).toBe(false);
  });

  it('archives the conversation when the task asked for it, and links to it anyway', async () => {
    const task = tasks.create({
      title: 'Noisy',
      prompt: 'a',
      scheduleKind: 'once',
      archiveChat: true,
    });

    await scheduler.tick();

    const stored = taskRepo.get(task.id);
    expect(stored?.lastChatId).toBeDefined();
    expect(chatRepo.list({ archived: false })).toEqual([]);
    expect(chatRepo.list({ archived: true }).map((chat) => chat.id)).toEqual([stored?.lastChatId]);
    // The status is still 'ok': filing the chat is not part of the outcome.
    expect(stored?.lastStatus).toBe('ok');
  });

  it('leaves the conversation in the sidebar by default', async () => {
    tasks.create({ title: 'Ordinary', prompt: 'a', scheduleKind: 'once' });

    await scheduler.tick();

    expect(chatRepo.list({ archived: false })).toHaveLength(1);
    expect(chatRepo.list({ archived: true })).toEqual([]);
  });
});

describe('failures', () => {
  it('records the failure code and keeps the schedule alive', async () => {
    const task = tasks.create({
      title: 'Flaky',
      prompt: 'a',
      scheduleKind: 'interval',
      intervalMinutes: 5,
    });
    clock.advance(5 * MINUTE);
    bridge.script = (request) => {
      request.onEvent({ kind: 'error', code: 'provider_error' });
      return Promise.resolve();
    };

    await scheduler.tick();

    const stored = taskRepo.get(task.id);
    expect(stored?.lastStatus).toBe('provider_error');
    expect(stored?.enabled).toBe(true);
    expect(stored?.nextRunAt).toBe(clock.now() + 5 * MINUTE);
  });

  it('a throwing run neither stalls nor kills the queue', async () => {
    const first = tasks.create({ title: 'Boom', prompt: 'a', scheduleKind: 'once' });
    const second = tasks.create({ title: 'Fine', prompt: 'b', scheduleKind: 'once' });
    bridge.script = (request) => {
      if (request.prompt === 'a') throw new Error('the engine exploded');
      request.onEvent({ kind: 'delta', text: 'ok' });
      return Promise.resolve();
    };

    await scheduler.tick();

    // The bridge throwing is a failed run, not a failed scheduler.
    expect(taskRepo.get(first.id)?.lastStatus).toBe('operation_error');
    expect(taskRepo.get(second.id)?.lastStatus).toBe('ok');
    expect(journal).toHaveLength(2);
  });
});

describe('the queue', () => {
  it('never has two task runs in flight at once', async () => {
    for (const title of ['One', 'Two', 'Three']) {
      tasks.create({ title, prompt: title, scheduleKind: 'once' });
    }

    let inFlight = 0;
    let peak = 0;
    bridge.script = async (request) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await Promise.resolve();
      request.onEvent({ kind: 'delta', text: 'x' });
      inFlight -= 1;
    };

    await scheduler.tick();

    expect(bridge.prompts).toHaveLength(3);
    expect(peak).toBe(1);
  });

  it('run-now queues a task that is switched off, without switching it on', async () => {
    const task = tasks.create({ title: 'Manual', prompt: 'a', scheduleKind: 'interval', intervalMinutes: 60 });
    tasks.toggle(task.id, false);

    expect(scheduler.runNow(task.id)).toBe(true);
    await scheduler.whenIdle();

    const stored = taskRepo.get(task.id);
    expect(stored?.lastStatus).toBe('ok');
    expect(stored?.enabled).toBe(false);
    expect(bridge.prompts).toEqual(['a']);
  });

  it('run-now says no to a task that does not exist', () => {
    expect(scheduler.runNow('task-nope')).toBe(false);
  });

  it('a task deleted while it waits in the queue is simply skipped', async () => {
    const first = tasks.create({ title: 'First', prompt: 'a', scheduleKind: 'once' });
    const second = tasks.create({ title: 'Second', prompt: 'b', scheduleKind: 'once' });

    scheduler.runNow(first.id); // takes the queue and starts at once
    scheduler.runNow(second.id); // waits behind it
    tasks.delete(second.id);
    await scheduler.whenIdle();

    expect(bridge.prompts).toEqual(['a']);
  });
});

describe('the timer', () => {
  it('starts once, at the tick interval, and stops on request', () => {
    scheduler.start();
    scheduler.start();
    expect(timer.everyMs).toBe(30_000);

    scheduler.stop();
    expect(timer.stops).toBe(1);
  });

  it('a fired timer runs what is due', async () => {
    tasks.create({ title: 'Timed', prompt: 'a', scheduleKind: 'once' });
    scheduler.start();
    timer.fire?.();
    await scheduler.whenIdle();

    expect(bridge.prompts).toEqual(['a']);
  });
});

describe('maintenance jobs', () => {
  it('runs on the first tick, then only once its cadence has passed', async () => {
    const runsAt: number[] = [];
    build([
      {
        name: 'sweep',
        everyMs: 24 * 60 * 60 * 1000,
        run: () => {
          runsAt.push(clock.now());
        },
      },
    ]);

    await scheduler.tick();
    clock.advance(60 * MINUTE);
    await scheduler.tick();
    clock.advance(24 * 60 * MINUTE);
    await scheduler.tick();

    expect(runsAt).toEqual([NOW, NOW + 60 * MINUTE + 24 * 60 * MINUTE]);
  });

  it('a job that throws is logged, and the next tick still happens', async () => {
    build([
      {
        name: 'sweep',
        everyMs: 1,
        run: () => {
          throw new Error('disk on fire');
        },
      },
    ]);

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(journal[0]).toContain('pop job sweep failed: disk on fire');
  });
});
