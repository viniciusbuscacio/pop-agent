import Database from 'better-sqlite3';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it } from 'vitest';
import type {
  AgentEvent,
  AgentRunControl,
  AgentRunResult,
} from '../../application/ports/agent-bridge.js';
import { migrate } from '../db/migrate.js';
import { SqliteChatRepo } from '../db/sqlite-chat-repo.js';
import { PiAgentBridge, extractHttpStatus, isNetworkFailure, type PiRunUsage } from './pi-bridge.js';
import { PiEngineError, type PiEngine, type PiOpenOptions, type PiSession } from './pi-engine.js';

/**
 * The bridge, against a pi that is scripted rather than paid for.
 *
 * The events below are shaped exactly as the SDK emits them -- typed as
 * `AgentSessionEvent`, so a pi release that changes the shape fails to compile
 * here instead of failing quietly in production. What is being tested is
 * everything Pop Agent adds on top: the mapping, the snapshot-to-delta diffing of
 * tool output, the verdict on a run that pi retried, the session cache.
 */

const CHAT = 'chat-abcdef123456';

/** A minimal JSONL tree so rewind tests can count user prompts on the main path. */
class SessionTree {
  private leafId: string | null = null;
  private nextId = 0;
  private readonly entries = new Map<
    string,
    { id: string; parentId: string | null; role: 'user' | 'assistant'; text: string }
  >();

  getLeafId(): string | null {
    return this.leafId;
  }

  appendUser(text: string): void {
    const id = `e${String(this.nextId++)}`;
    this.entries.set(id, { id, parentId: this.leafId, role: 'user', text });
    this.leafId = id;
  }

  appendAssistant(text: string): void {
    const id = `e${String(this.nextId++)}`;
    this.entries.set(id, { id, parentId: this.leafId, role: 'assistant', text });
    this.leafId = id;
  }

  rewindTo(leafId: string | null): void {
    this.leafId = leafId;
  }

  userPromptsOnMainPath(): string[] {
    const prompts: string[] = [];
    let current = this.leafId === null ? undefined : this.entries.get(this.leafId);
    while (current !== undefined) {
      if (current.role === 'user') prompts.unshift(current.text);
      current = current.parentId === null ? undefined : this.entries.get(current.parentId);
    }
    return prompts;
  }
}

/** pi's own message type, reached through the event union rather than imported
 * from a package that is only a transitive dependency here. */
type PiAssistantMessage = Extract<
  Extract<AgentSessionEvent, { type: 'message_end' }>['message'],
  { role: 'assistant' }
>;

function textDelta(text: string): AgentSessionEvent {
  return {
    type: 'message_update',
    message: assistantMessage(),
    assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: text, partial: assistantMessage() },
  };
}

function thinkingDelta(text: string): AgentSessionEvent {
  return {
    type: 'message_update',
    message: assistantMessage(),
    assistantMessageEvent: {
      type: 'thinking_delta',
      contentIndex: 0,
      delta: text,
      partial: assistantMessage(),
    },
  };
}

function settled(
  stopReason: 'stop' | 'error' | 'aborted' | 'toolUse',
  usage: { input: number; output: number; cost: number },
  errorMessage?: string,
): AgentSessionEvent {
  const message = assistantMessage();
  message.stopReason = stopReason;
  if (errorMessage !== undefined) message.errorMessage = errorMessage;
  message.usage = {
    input: usage.input,
    output: usage.output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: usage.input + usage.output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: usage.cost },
  };
  return { type: 'message_end', message };
}

function assistantMessage(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: 'openai-completions',
    provider: 'openrouter',
    model: 'moonshotai/kimi-k3',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'stop',
    timestamp: 0,
  };
}

function toolText(text: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text }] };
}

/** A pi session whose whole behaviour is a list of events to emit. */
class ScriptedSession implements PiSession {
  script: AgentSessionEvent[] = [];
  /** Emitted instead of the script when the run is aborted mid-flight. */
  onPrompt: (() => Promise<void>) | undefined;
  readonly prompts: string[] = [];
  readonly promptImages: (import('./pi-engine.js').PiImage[] | undefined)[] = [];
  supportsImages = false;
  readonly models: string[] = [];
  executionMode: import('../../domain/chat/chat.js').ExecutionMode = 'normal';
  disposed = false;
  sessionFile: string | undefined = '/data/sessions/chat.jsonl';
  readonly tree = new SessionTree();
  private listener: ((event: AgentSessionEvent) => void) | undefined;

  setExecutionMode(mode: import('../../domain/chat/chat.js').ExecutionMode): void {
    this.executionMode = mode;
  }

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(event: AgentSessionEvent): void {
    this.listener?.(event);
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      const text = event.message.content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('');
      if (text.length > 0) this.tree.appendAssistant(text);
    }
  }

  async prompt(text: string, images?: import('./pi-engine.js').PiImage[]): Promise<void> {
    this.prompts.push(text);
    this.promptImages.push(images);
    this.tree.appendUser(text);
    if (this.onPrompt !== undefined) {
      await this.onPrompt();
      return;
    }
    for (const event of this.script) this.emit(event);
    await Promise.resolve();
  }

  readonly steering: string[] = [];
  steeringMode: 'all' | 'one-at-a-time' = 'one-at-a-time';
  steer(text: string): Promise<void> {
    this.steering.push(text);
    return Promise.resolve();
  }

  setSteeringMode(mode: 'all' | 'one-at-a-time'): void {
    this.steeringMode = mode;
  }

  clearQueue(): { steering: string[]; followUp: string[] } {
    const steering = this.steering.splice(0);
    return { steering, followUp: [] };
  }

  compactions = 0;

  compact(): Promise<void> {
    this.compactions += 1;
    return Promise.resolve();
  }

  abort(): Promise<void> {
    return Promise.resolve();
  }

  setModel(_providerId: string, modelId: string): Promise<void> {
    this.models.push(modelId);
    return Promise.resolve();
  }

  guard: import('./pi-engine.js').ToolGuard | undefined;
  setGuard(guard: import('./pi-engine.js').ToolGuard | undefined): void {
    this.guard = guard;
  }

  dispose(): void {
    this.disposed = true;
  }

  getLeafId(): string | null {
    return this.tree.getLeafId();
  }

  rewindToLeaf(leafId: string | null): void {
    this.tree.rewindTo(leafId);
  }
}

class ScriptedEngine implements PiEngine {
  complete(): Promise<{ text: string }> {
    return Promise.resolve({ text: 'scripted' });
  }

  readonly sessions: ScriptedSession[] = [];
  readonly opened: PiOpenOptions[] = [];
  failure: Error | undefined;
  next = new ScriptedSession();

  open(options: PiOpenOptions): Promise<PiSession> {
    if (this.failure !== undefined) return Promise.reject(this.failure);
    this.opened.push(options);
    this.sessions.push(this.next);
    return Promise.resolve(this.next);
  }

  models(): Promise<{ id: string }[]> {
    return Promise.resolve([{ id: 'moonshotai/kimi-k3' }]);
  }

  hasProviderAuth(): boolean {
    return false;
  }

  providerLogin(): Promise<void> {
    return Promise.reject(new Error('the scripted engine cannot sign in'));
  }

  providerLogout(): Promise<void> {
    return Promise.resolve();
  }

  providerSubscriptionUsage(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

let db: Database.Database;
let chats: SqliteChatRepo;
let engine: ScriptedEngine;
let bridge: PiAgentBridge;
let usages: PiRunUsage[];

function collect(): { events: AgentEvent[]; onEvent: (event: AgentEvent) => void } {
  const events: AgentEvent[] = [];
  return { events, onEvent: (event) => events.push(event) };
}

function run(
  onEvent: (event: AgentEvent) => void,
  options: {
    model?: string;
    provider?: string;
    signal?: AbortSignal;
    executionMode?: import('../../domain/chat/chat.js').ExecutionMode;
  } = {},
): Promise<AgentRunResult> {
  return bridge.run({
    chatId: CHAT,
    prompt: 'hello',
    model: options.model ?? '',
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    attachments: [],
    ...(options.executionMode === undefined ? {} : { executionMode: options.executionMode }),
    onEvent,
    signal: options.signal ?? new AbortController().signal,
  });
}

beforeEach(() => {
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  chats = new SqliteChatRepo(db);
  chats.create({
    id: CHAT,
    title: 'New chat',
    model: '',
    provider: '',
    archived: false,
    pinned: false,
    piSessionId: '',
    summary: '',
    autoTitle: true,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  });
  engine = new ScriptedEngine();
  usages = [];
  bridge = new PiAgentBridge({
    chats,
    engine,
    idleMs: 60_000,
    onUsage: (usage) => usages.push(usage),
  });
});

describe('mapping pi events', () => {
  it('turns text and thinking into deltas', async () => {
    engine.next.script = [thinkingDelta('weighing it. '), textDelta('Hello'), textDelta(' there')];
    const { events, onEvent } = collect();

    await run(onEvent);

    expect(events).toEqual([
      { kind: 'thinking', text: 'weighing it. ' },
      { kind: 'delta', text: 'Hello' },
      { kind: 'delta', text: ' there' },
    ]);
  });

  it('sends only the new tail of a tool output, not the whole snapshot again', async () => {
    // pi re-sends everything the command has printed so far, every 100ms. The
    // UI and the stored record append, so forwarding a snapshot verbatim would
    // repeat the output on screen.
    engine.next.script = [
      { type: 'tool_execution_start', toolCallId: 't1', toolName: 'bash', args: { command: 'ls' } },
      {
        type: 'tool_execution_update',
        toolCallId: 't1',
        toolName: 'bash',
        args: {},
        partialResult: toolText('one\n'),
      },
      {
        type: 'tool_execution_update',
        toolCallId: 't1',
        toolName: 'bash',
        args: {},
        partialResult: toolText('one\ntwo\n'),
      },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'bash',
        result: toolText('one\ntwo\nthree\n'),
        isError: false,
      },
    ];
    const { events, onEvent } = collect();

    await run(onEvent);

    expect(events).toEqual([
      { kind: 'tool', name: 'bash', status: 'start', detail: 'ls\n' },
      { kind: 'tool', name: 'bash', status: 'output', detail: 'one\n' },
      { kind: 'tool', name: 'bash', status: 'output', detail: 'two\n' },
      { kind: 'tool', name: 'bash', status: 'done', detail: 'three\n' },
    ]);
  });

  it('hands a live steering input to pi and reports when pi consumes it', async () => {
    let release: () => void = () => undefined;
    engine.next.onPrompt = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    let control: AgentRunControl | undefined;
    const { events, onEvent } = collect();
    const running = bridge.run({
      chatId: CHAT,
      prompt: 'hello',
      model: '',
      attachments: [],
      onEvent,
      onControlReady: (ready) => {
        control = ready;
      },
      signal: new AbortController().signal,
    });
    for (let attempt = 0; attempt < 20 && control === undefined; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    expect(control).toBeDefined();
    await control?.steer({
      id: 'queued-A1b2C3d4E5f',
      prompt: 'change course',
      attachments: [],
    });
    const prompt = engine.next.steering[0];
    expect(prompt).toContain('change course');
    engine.next.emit({
      type: 'message_start',
      message: {
        role: 'user',
        content: [{ type: 'text', text: prompt ?? '' }],
        timestamp: Date.now(),
      },
    });
    release();
    await running;

    expect(events).toContainEqual({
      kind: 'steering-delivered',
      steeringId: 'queued-A1b2C3d4E5f',
    });
  });

  it('queues several steering inputs in pi and reports each consumption in FIFO order', async () => {
    let release: () => void = () => undefined;
    engine.next.onPrompt = () =>
      new Promise<void>((resolve) => {
        release = resolve;
      });
    let control: AgentRunControl | undefined;
    const { events, onEvent } = collect();
    const running = bridge.run({
      chatId: CHAT,
      prompt: 'hello',
      model: '',
      attachments: [],
      onEvent,
      onControlReady: (ready) => {
        control = ready;
      },
      signal: new AbortController().signal,
    });
    for (let attempt = 0; attempt < 20 && control === undefined; attempt += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    await Promise.all([
      control?.steer({
        id: 'queued-A1b2C3d4E5f',
        prompt: 'first change',
        attachments: [],
      }),
      control?.steer({
        id: 'queued-F6g7H8i9J0k',
        prompt: 'second change',
        attachments: [],
      }),
    ]);
    expect(engine.next.steeringMode).toBe('all');
    expect(engine.next.steering).toHaveLength(2);
    for (const prompt of engine.next.steering) {
      engine.next.emit({
        type: 'message_start',
        message: {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
          timestamp: Date.now(),
        },
      });
    }
    release();
    await running;

    expect(events.filter((event) => event.kind === 'steering-delivered')).toEqual([
      { kind: 'steering-delivered', steeringId: 'queued-A1b2C3d4E5f' },
      { kind: 'steering-delivered', steeringId: 'queued-F6g7H8i9J0k' },
    ]);
  });

  it('marks a failed tool call as an error', async () => {
    engine.next.script = [
      { type: 'tool_execution_start', toolCallId: 't1', toolName: 'read', args: { path: '/nope' } },
      {
        type: 'tool_execution_end',
        toolCallId: 't1',
        toolName: 'read',
        result: toolText('no such file'),
        isError: true,
      },
    ];
    const { events, onEvent } = collect();

    await run(onEvent);

    expect(events).toEqual([
      { kind: 'tool', name: 'read', status: 'start', detail: '/nope\n' },
      { kind: 'tool', name: 'read', status: 'error', detail: 'no such file' },
    ]);
  });
});

describe('how a run ends', () => {
  it('says nothing when the turn ended normally', async () => {
    engine.next.script = [textDelta('done'), settled('stop', { input: 10, output: 3, cost: 0.001 })];
    const { events, onEvent } = collect();

    await run(onEvent);

    expect(events.some((event) => event.kind === 'error')).toBe(false);
  });

  it('does not report a failure pi retried out of', async () => {
    // pi retries a retryable error by itself: a message that ended badly can be
    // followed by one that ended well, and only the last word counts.
    engine.next.script = [
      settled('error', { input: 5, output: 0, cost: 0 }, 'rate limited'),
      textDelta('second time lucky'),
      settled('stop', { input: 10, output: 4, cost: 0.002 }),
    ];
    const { events, onEvent } = collect();

    await run(onEvent);

    expect(events.some((event) => event.kind === 'error')).toBe(false);
  });

  it('reports a provider failure once the run is over', async () => {
    const failures: { code: string; message: string | undefined }[] = [];
    bridge = new PiAgentBridge({
      chats,
      engine,
      onFailure: (failure) => failures.push({ code: failure.code, message: failure.message }),
    });
    engine.next.script = [settled('error', { input: 5, output: 0, cost: 0 }, 'insufficient credit')];
    const { events, onEvent } = collect();

    await run(onEvent);

    expect(events).toContainEqual({ kind: 'error', code: 'provider_error' });
    // The wire carries the code; the log carries what the provider said.
    expect(failures).toEqual([{ code: 'provider_error', message: 'insufficient credit' }]);
  });

  it('books the sum of both attempts after overflow compact-and-retry', async () => {
    let calls = 0;
    engine.next.onPrompt = () => {
      calls += 1;
      if (calls === 1) {
        engine.next.emit(
          settled('error', { input: 100, output: 10, cost: 0.01 }, 'maximum context length exceeded'),
        );
      } else {
        engine.next.emit(textDelta('recovered'));
        engine.next.emit(settled('stop', { input: 50, output: 5, cost: 0.005 }));
      }
      return Promise.resolve();
    };
    const { onEvent } = collect();

    const result = await run(onEvent);

    expect(result.usage?.inputTokens).toBe(150);
    expect(result.usage?.outputTokens).toBe(15);
    expect(result.usage?.cost).toBeCloseTo(0.015, 10);
    expect(usages[0]?.inputTokens).toBe(150);
  });

  it('compacts and retries the turn once when the provider reports overflow', async () => {
    const failures: { code: string }[] = [];
    bridge = new PiAgentBridge({
      chats,
      engine,
      onFailure: (failure) => failures.push({ code: failure.code }),
    });
    let calls = 0;
    engine.next.onPrompt = () => {
      calls += 1;
      if (calls === 1) {
        engine.next.emit(
          settled('error', { input: 5, output: 0, cost: 0 }, 'maximum context length exceeded'),
        );
      } else {
        engine.next.emit(textDelta('recovered'));
        engine.next.emit(settled('stop', { input: 5, output: 3, cost: 0 }));
      }
      return Promise.resolve();
    };
    const { events, onEvent } = collect();

    await run(onEvent);

    expect(engine.next.compactions).toBe(1);
    expect(calls).toBe(2);
    // One seamless run: the retried turn succeeded, no error reached the user.
    expect(events.some((event) => event.kind === 'error')).toBe(false);
    expect(events).toContainEqual({ kind: 'delta', text: 'recovered' });
    expect(failures).toEqual([{ code: 'context_overflow' }]);
  });

  it('retries an overflow exactly once, never in a loop', async () => {
    let calls = 0;
    engine.next.onPrompt = () => {
      calls += 1;
      engine.next.emit(
        settled('error', { input: 5, output: 0, cost: 0 }, 'prompt is too long'),
      );
      return Promise.resolve();
    };
    const { events, onEvent } = collect();

    await run(onEvent);

    expect(calls).toBe(2); // the first attempt and the single retry
    expect(engine.next.compactions).toBe(1);
    expect(events).toContainEqual({ kind: 'error', code: 'provider_error' });
  });

  it('does not retry a non-overflow provider error', async () => {
    let calls = 0;
    engine.next.onPrompt = () => {
      calls += 1;
      engine.next.emit(settled('error', { input: 5, output: 0, cost: 0 }, 'insufficient credit'));
      return Promise.resolve();
    };
    const { onEvent } = collect();

    await run(onEvent);

    expect(calls).toBe(1);
    expect(engine.next.compactions).toBe(0);
  });

  it('reports an aborted run as aborted', async () => {
    const controller = new AbortController();
    engine.next.onPrompt = async () => {
      engine.next.emit(textDelta('half an ans'));
      controller.abort();
      await Promise.resolve();
    };
    const { events, onEvent } = collect();

    await run(onEvent, { signal: controller.signal });

    expect(events).toEqual([
      { kind: 'delta', text: 'half an ans' },
      { kind: 'error', code: 'aborted' },
    ]);
  });

  it('surfaces an engine that has no key as a code the UI can act on', async () => {
    engine.failure = new PiEngineError('provider_not_configured', 'no API key for openrouter');
    const { events, onEvent } = collect();

    await run(onEvent);

    expect(events).toEqual([{ kind: 'error', code: 'provider_not_configured' }]);
  });
});

describe('accounting', () => {
  it('adds up every model call in the run', async () => {
    // A tool loop is at least two calls to the model, and both are billed.
    engine.next.script = [
      settled('toolUse', { input: 100, output: 20, cost: 0.0006 }),
      settled('stop', { input: 300, output: 40, cost: 0.0015 }),
    ];
    const { onEvent } = collect();

    const result = await run(onEvent);

    expect(usages).toHaveLength(1);
    expect(usages[0]?.chatId).toBe(CHAT);
    expect(usages[0]?.model).toBe('moonshotai/kimi-k3');
    expect(usages[0]?.inputTokens).toBe(400);
    expect(usages[0]?.outputTokens).toBe(60);
    expect(usages[0]?.cost).toBeCloseTo(0.0021, 10);

    // The same numbers come back through the port, for llm_runs to book.
    expect(result.usage?.provider).toBe('openrouter');
    expect(result.usage?.model).toBe('moonshotai/kimi-k3');
    expect(result.usage?.inputTokens).toBe(400);
    expect(result.usage?.outputTokens).toBe(60);
    expect(result.usage?.cost).toBeCloseTo(0.0021, 10);
  });

  it('reports no usage when the engine was never reached', async () => {
    engine.failure = new PiEngineError('provider_not_configured', 'no key');
    const { onEvent } = collect();

    expect(await run(onEvent)).toEqual({});
  });
});

describe('sessions', () => {
  it('opens one session per chat and reuses it', async () => {
    const { onEvent } = collect();

    await run(onEvent);
    await run(onEvent);

    expect(engine.opened).toHaveLength(1);
  });

  it('remembers where pi keeps the conversation', async () => {
    const { onEvent } = collect();

    await run(onEvent);

    expect(chats.get(CHAT)?.piSessionId).toBe('/data/sessions/chat.jsonl');
  });

  it('hands the stored path back when the chat wakes up again', async () => {
    chats.setPiSessionId(CHAT, '/data/sessions/older.jsonl');
    const { onEvent } = collect();

    await run(onEvent);

    expect(engine.opened[0]?.sessionFile).toBe('/data/sessions/older.jsonl');
  });

  it('switches a model in place when the provider stays the same', async () => {
    const { onEvent } = collect();

    await run(onEvent, { provider: 'openrouter', model: 'moonshotai/kimi-k3' });
    await run(onEvent, { provider: 'openrouter', model: 'openai/gpt-5' });

    expect(engine.opened).toHaveLength(1);
    expect(engine.sessions[0]?.models).toEqual(['openai/gpt-5']);
  });

  it('reopens the saved conversation when fallback switches providers', async () => {
    const { onEvent } = collect();

    await run(onEvent, { provider: 'openrouter', model: 'moonshotai/kimi-k3' });
    const first = engine.sessions[0];
    engine.next = new ScriptedSession();
    await run(onEvent, { provider: 'custom-mar', model: 'sabia-4' });

    expect(first?.disposed).toBe(true);
    expect(first?.models).toEqual([]);
    expect(engine.opened).toHaveLength(2);
    expect(engine.opened[1]).toMatchObject({
      providerId: 'custom-mar',
      modelId: 'sabia-4',
      sessionFile: '/data/sessions/chat.jsonl',
    });
  });

  it('hard-forgets a session even while busy', async () => {
    const { onEvent } = collect();
    await run(onEvent);

    bridge.discardSession(CHAT);

    expect(engine.sessions[0]?.disposed).toBe(true);
    expect(engine.opened).toHaveLength(1);
    engine.next = new ScriptedSession();
    await run(onEvent);
    expect(engine.opened).toHaveLength(2);
  });

  it('disposes what it cached when it is closed', async () => {
    const { onEvent } = collect();
    await run(onEvent);

    bridge.close();

    expect(engine.sessions[0]?.disposed).toBe(true);
  });

  it('reopens the session when the custom instructions change', async () => {
    // Instructions live in the system prompt, fixed when a session opens.
    // Reopening from the JSONL is the restart move: the conversation's context
    // survives, only the prompt changes.
    let instructions = 'Answer briefly.';
    bridge = new PiAgentBridge({ chats, engine, instructions: () => instructions });
    const { onEvent } = collect();

    await run(onEvent);
    const first = engine.next;
    engine.next = new ScriptedSession();
    instructions = 'Answer at length.';
    await run(onEvent);

    expect(first.disposed).toBe(true);
    expect(engine.opened).toHaveLength(2);
    expect(engine.opened.map((entry) => entry.instructions)).toEqual([
      'Answer briefly.',
      'Answer at length.',
    ]);
    // The second open resumes the same conversation, not a blank one.
    expect(engine.opened[1]?.sessionFile).toBe('/data/sessions/chat.jsonl');
  });

  it('keeps the session while the instructions do not change', async () => {
    bridge = new PiAgentBridge({ chats, engine, instructions: () => 'Same words.' });
    const { onEvent } = collect();

    await run(onEvent);
    await run(onEvent);

    expect(engine.opened).toHaveLength(1);
  });
});

describe('attachments', () => {
  it('writes the files into the workspace and tells the model where', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const workspace = mkdtempSync(join(tmpdir(), 'pop-bridge-test-'));

    try {
      bridge = new PiAgentBridge({ chats, engine, workspace });
      const { onEvent } = collect();

      await bridge.run({
        chatId: CHAT,
        prompt: 'read my notes',
        model: '',
        attachments: [
          {
            name: '../sneaky notes.txt',
            type: 'text/plain',
            dataUri: `data:text/plain;base64,${Buffer.from('remember the milk').toString('base64')}`,
          },
        ],
        onEvent,
        signal: new AbortController().signal,
      });

      // The traversal is gone from the name, the content survived the trip.
      const saved = join(workspace, 'attachments', CHAT, 'sneaky notes.txt');
      expect(readFileSync(saved, 'utf8')).toBe('remember the milk');

      const prompt = engine.sessions[0]?.prompts[0] ?? '';
      expect(prompt).toContain('read my notes');
      expect(prompt).toContain(`attachments/${CHAT}/sneaky notes.txt`);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('leaves the prompt alone when there is nothing attached', async () => {
    const { onEvent } = collect();

    await run(onEvent);

    const sent = engine.sessions[0]?.prompts[0] ?? '';
    expect(sent).toContain('hello');
    expect(sent).not.toContain('attach');
  });

  it('sends image attachments to a multimodal model', async () => {
    engine.next.supportsImages = true;
    const { onEvent } = collect();

    await bridge.run({
      chatId: CHAT,
      prompt: 'what is in this image',
      model: '',
      attachments: [
        {
          name: 'pic.png',
          type: 'image/png',
          dataUri: `data:image/png;base64,${Buffer.from([1, 2, 3]).toString('base64')}`,
        },
      ],
      onEvent,
      signal: new AbortController().signal,
    });

    const images = engine.sessions[0]?.promptImages[0];
    expect(images).toHaveLength(1);
    expect(images?.[0]).toMatchObject({ mimeType: 'image/png' });
  });

  it('withholds images from a text-only model', async () => {
    engine.next.supportsImages = false;
    const { onEvent } = collect();

    await bridge.run({
      chatId: CHAT,
      prompt: 'x',
      model: '',
      attachments: [
        {
          name: 'pic.png',
          type: 'image/png',
          dataUri: `data:image/png;base64,${Buffer.from([1]).toString('base64')}`,
        },
      ],
      onEvent,
      signal: new AbortController().signal,
    });

    expect(engine.sessions[0]?.promptImages[0]).toBeUndefined();
  });
});

describe('typing provider failures for failover (pop-agent.spec §15, fase 2)', () => {
  it('reads the status from the code-shaped places providers put it', () => {
    expect(extractHttpStatus('402 {"error":{"message":"Insufficient credits"}}')).toBe(402);
    expect(extractHttpStatus('Provider returned error, status code: 429')).toBe(429);
    expect(extractHttpStatus('OpenAI answered 503 Service Unavailable')).toBe(503);
    expect(extractHttpStatus('(529) Overloaded')).toBe(529);
  });

  it('refuses to mistake prose numbers for a status', () => {
    expect(extractHttpStatus('the model gpt-404 answered with 500 tokens')).toBeUndefined();
    expect(extractHttpStatus('reduce the length: 401234 tokens sent')).toBeUndefined();
    expect(extractHttpStatus(undefined)).toBeUndefined();
  });

  it('recognizes the wire failing, by code-like tokens', () => {
    expect(isNetworkFailure('connect ECONNREFUSED 127.0.0.1:443')).toBe(true);
    expect(isNetworkFailure('fetch failed')).toBe(true);
    expect(isNetworkFailure('socket hang up')).toBe(true);
    expect(isNetworkFailure('TLS handshake timeout')).toBe(true);
    expect(isNetworkFailure('Payment Required')).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});

describe('runtime identity', () => {
  it('states the pair answering this turn, ahead of the prompt', async () => {
    await run(collect().onEvent, { model: 'gpt-5.5', provider: 'openai-codex' });

    const sent = engine.sessions[0]?.prompts[0] ?? '';
    expect(sent).toContain('provider "openai-codex"');
    expect(sent).toContain('model "gpt-5.5"');
    // Ahead of it, so a stale claim later in the prompt loses the argument.
    expect(sent.indexOf('openai-codex')).toBeLessThan(sent.indexOf('hello'));
  });

  it('says "the configured default" rather than inventing a pair', async () => {
    await run(collect().onEvent);

    expect(engine.sessions[0]?.prompts[0] ?? '').toContain('the configured default');
  });

  it('switches pi to read-only tools and tells the model when Plan Mode is active', async () => {
    await run(collect().onEvent, { executionMode: 'plan' });

    expect(engine.sessions[0]?.executionMode).toBe('plan');
    expect(engine.sessions[0]?.prompts[0] ?? '').toContain('PLAN MODE ACTIVE');
    expect(engine.sessions[0]?.prompts[0] ?? '').toContain('strictly read-only');
  });
});

describe('session rewind on retry (pop-agent.spec §15)', () => {
  it('leaves one user prompt on the main path after overflow compact-and-retry', async () => {
    let calls = 0;
    engine.next.onPrompt = () => {
      calls += 1;
      if (calls === 1) {
        engine.next.emit(
          settled('error', { input: 5, output: 0, cost: 0 }, 'maximum context length exceeded'),
        );
      } else {
        engine.next.emit(textDelta('recovered'));
        engine.next.emit(settled('stop', { input: 5, output: 3, cost: 0 }));
      }
      return Promise.resolve();
    };
    const { onEvent } = collect();

    await run(onEvent);

    expect(calls).toBe(2);
    expect(engine.sessions[0]?.tree.userPromptsOnMainPath()).toHaveLength(1);
  });

  it('rewinds the leaf on a failover-class failure so the main path stays clean', async () => {
    engine.next.script = [
      settled('error', { input: 5, output: 0, cost: 0 }, '402 Payment Required'),
    ];
    const { onEvent } = collect();

    await run(onEvent);

    // The doomed turn sits on an abandoned branch; the main path is back at
    // pre-prompt (empty here), ready for the next provider.
    expect(engine.sessions[0]?.prompts).toHaveLength(1);
    expect(engine.sessions[0]?.tree.userPromptsOnMainPath()).toHaveLength(0);
    expect(engine.sessions[0]?.getLeafId()).toBeNull();
  });

  it('rewinds before a second bridge.run so failover does not duplicate the prompt', async () => {
    engine.next.onPrompt = () => {
      if (engine.next.prompts.length === 1) {
        engine.next.emit(settled('error', { input: 5, output: 0, cost: 0 }, '429 Too Many Requests'));
      } else {
        engine.next.emit(textDelta('second provider'));
        engine.next.emit(settled('stop', { input: 5, output: 3, cost: 0 }));
      }
      return Promise.resolve();
    };
    const { onEvent } = collect();

    await run(onEvent);
    await run(onEvent);

    expect(engine.sessions[0]?.tree.userPromptsOnMainPath()).toHaveLength(1);
  });
});
