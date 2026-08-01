import Database from 'better-sqlite3';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent, AgentRunResult } from '../../application/ports/agent-bridge.js';
import { migrate } from '../db/migrate.js';
import { SqliteChatRepo } from '../db/sqlite-chat-repo.js';
import { PiAgentBridge, type PiRunUsage } from './pi-bridge.js';
import { PiEngineError, type PiEngine, type PiOpenOptions, type PiSession } from './pi-engine.js';

/**
 * The bridge, against a pi that is scripted rather than paid for.
 *
 * The events below are shaped exactly as the SDK emits them -- typed as
 * `AgentSessionEvent`, so a pi release that changes the shape fails to compile
 * here instead of failing quietly in production. What is being tested is
 * everything Popy adds on top: the mapping, the snapshot-to-delta diffing of
 * tool output, the verdict on a run that pi retried, the session cache.
 */

const CHAT = 'chat-abcdef123456';

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
  disposed = false;
  sessionFile: string | undefined = '/data/sessions/chat.jsonl';
  private listener: ((event: AgentSessionEvent) => void) | undefined;

  subscribe(listener: (event: AgentSessionEvent) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(event: AgentSessionEvent): void {
    this.listener?.(event);
  }

  async prompt(text: string, images?: import('./pi-engine.js').PiImage[]): Promise<void> {
    this.prompts.push(text);
    this.promptImages.push(images);
    if (this.onPrompt !== undefined) {
      await this.onPrompt();
      return;
    }
    for (const event of this.script) this.emit(event);
    await Promise.resolve();
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
}

class ScriptedEngine implements PiEngine {
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
  options: { model?: string; signal?: AbortSignal } = {},
): Promise<AgentRunResult> {
  return bridge.run({
    chatId: CHAT,
    prompt: 'hello',
    model: options.model ?? '',
    attachments: [],
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

  it('switches the model in place rather than starting over', async () => {
    const { onEvent } = collect();

    await run(onEvent, { model: 'moonshotai/kimi-k3' });
    await run(onEvent, { model: 'openai/gpt-5' });

    expect(engine.opened).toHaveLength(1);
    expect(engine.sessions[0]?.models).toEqual(['openai/gpt-5']);
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
    const workspace = mkdtempSync(join(tmpdir(), 'popy-bridge-test-'));

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

    expect(engine.sessions[0]?.prompts[0]).toBe('hello');
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
