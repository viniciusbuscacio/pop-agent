import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type {
  AgentBridge,
  AgentEvent,
  AgentRunRequest,
  ModelInfo,
} from '../../application/ports/agent-bridge.js';
import type { ChatRepo } from '../../application/ports/chat-repo.js';
import { DEFAULT_MODEL_ID, PiEngineError, type PiEngine, type PiSession } from './pi-engine.js';

/**
 * pi behind the AgentBridge port (popy.spec §5, docs/agent-flow.md).
 *
 * It is the same port the scripted fake implements, and the application layer
 * did not change by a line to accept it -- which was the point of building
 * Phase 2 against a fake in the first place.
 *
 * Two things live here that the port cannot express:
 *
 * - **A session per conversation.** pi keeps the execution state (the context
 *   the model actually sees) in its own JSONL file; Popy keeps the product
 *   state in SQLite. The path to the former is stored on the chat, so a
 *   conversation resumes after an idle unload or a restart.
 * - **Tool output arrives as snapshots, not deltas.** pi re-sends the whole
 *   accumulated output every 100ms; the UI and the stored record append. So the
 *   bridge diffs each snapshot against what it already forwarded, and only the
 *   new tail goes on the wire.
 */

/** Sessions cost RAM, not money: unload after three idle hours (spec §5). */
const IDLE_DISPOSE_MS = 3 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** What one run cost, in the provider's own numbers. Phase 3 step 4 stores it. */
export interface PiRunUsage {
  chatId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** US dollars, as reported by pi's catalog pricing. */
  cost: number;
}

export interface PiBridgeDeps {
  chats: ChatRepo;
  engine: PiEngine;
  /** Used when a chat has no model of its own. */
  defaultModelId?: string;
  /** Overridable so tests do not wait three hours. */
  idleMs?: number;
  onUsage?: (usage: PiRunUsage) => void;
  /**
   * The wire carries a stable code and nothing else (popy.spec §13), which is
   * right for the UI and useless for whoever has to explain why a run failed.
   * The provider's own words go here, to the server log.
   */
  onFailure?: (failure: { chatId: string; code: string; message: string | undefined }) => void;
}

interface CachedSession {
  chatId: string;
  session: PiSession;
  modelId: string;
  /** Runs currently using it; a session in use is never swept. */
  busy: number;
  lastUsedAt: number;
}

export class PiAgentBridge implements AgentBridge {
  private readonly sessions = new Map<string, CachedSession>();
  private sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: PiBridgeDeps) {}

  async run(request: AgentRunRequest): Promise<void> {
    const { chatId, prompt, model, onEvent, signal } = request;

    let entry: CachedSession;
    try {
      entry = await this.acquire(chatId, model.length > 0 ? model : this.defaultModelId);
    } catch (error) {
      const code = errorCode(error);
      onEvent({ kind: 'error', code });
      this.deps.onFailure?.({ chatId, code, message: messageOf(error) });
      return;
    }

    const translator = new RunTranslator(onEvent);
    const unsubscribe = entry.session.subscribe((event) => {
      translator.handle(event);
    });

    // pi kills the process group of a running bash child on abort (it spawns
    // detached and SIGKILLs -pid), so stopping a run really does stop the work,
    // not just the stream.
    const onAbort = (): void => {
      void entry.session.abort();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      await entry.session.prompt(prompt);
      translator.finish(signal.aborted);
    } catch (error) {
      translator.fail(signal.aborted ? 'aborted' : errorCode(error), messageOf(error));
    } finally {
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
      this.release(entry);

      const usage = translator.usage;
      if (usage !== undefined && this.deps.onUsage !== undefined) {
        this.deps.onUsage({ chatId, model: entry.modelId, ...usage });
      }
      const failure = translator.failure;
      if (failure !== undefined && this.deps.onFailure !== undefined) {
        this.deps.onFailure({ chatId, ...failure });
      }
    }
  }

  listModels(): Promise<ModelInfo[]> {
    return this.deps.engine.models();
  }

  /** Disposes every live session. For shutdown and for tests. */
  close(): void {
    if (this.sweeper !== undefined) clearInterval(this.sweeper);
    this.sweeper = undefined;
    for (const entry of this.sessions.values()) entry.session.dispose();
    this.sessions.clear();
  }

  private get defaultModelId(): string {
    return this.deps.defaultModelId ?? DEFAULT_MODEL_ID;
  }

  private async acquire(chatId: string, modelId: string): Promise<CachedSession> {
    const cached = this.sessions.get(chatId);
    if (cached !== undefined) {
      if (cached.modelId !== modelId) {
        await cached.session.setModel(modelId);
        cached.modelId = modelId;
      }
      cached.busy += 1;
      cached.lastUsedAt = Date.now();
      return cached;
    }

    const chat = this.deps.chats.get(chatId);
    const session = await this.deps.engine.open({
      modelId,
      sessionFile: chat?.piSessionId,
    });

    const entry: CachedSession = { chatId, session, modelId, busy: 1, lastUsedAt: Date.now() };
    this.sessions.set(chatId, entry);
    this.rememberSessionFile(entry);
    this.startSweeping();
    return entry;
  }

  private release(entry: CachedSession): void {
    entry.busy = Math.max(0, entry.busy - 1);
    entry.lastUsedAt = Date.now();
    // pi names the file when it first writes to it, which can be during the
    // run rather than at open time.
    this.rememberSessionFile(entry);
  }

  private rememberSessionFile(entry: CachedSession): void {
    const file = entry.session.sessionFile;
    if (file === undefined || file.length === 0) return;
    if (this.deps.chats.get(entry.chatId)?.piSessionId === file) return;
    this.deps.chats.setPiSessionId(entry.chatId, file);
  }

  private startSweeping(): void {
    if (this.sweeper !== undefined) return;
    const idleMs = this.deps.idleMs ?? IDLE_DISPOSE_MS;
    this.sweeper = setInterval(() => {
      const deadline = Date.now() - idleMs;
      for (const [chatId, entry] of this.sessions) {
        if (entry.busy > 0 || entry.lastUsedAt > deadline) continue;
        entry.session.dispose();
        this.sessions.delete(chatId);
      }
    }, Math.min(SWEEP_INTERVAL_MS, idleMs));
    // A cache of idle sessions is not a reason to keep the process alive.
    this.sweeper.unref?.();
  }
}

/**
 * What the bridge consumes, once pi's event stream has been read for the parts
 * Popy renders. Anything else pi emits -- turn boundaries, compaction, retries,
 * queue updates -- is not an error, it is simply not ours.
 */
type PiSignal =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool-start'; id: string; name: string; args: unknown }
  | { kind: 'tool-update'; id: string; name: string; snapshot: unknown }
  | { kind: 'tool-end'; id: string; name: string; result: unknown; isError: boolean }
  | { kind: 'settled'; stopReason: string; message: string | undefined; usage: TurnUsage };

interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

/**
 * pi's events, mapped to the handful Popy renders (docs/agent-flow.md §1).
 *
 * Two corrections to the table written before the SDK was read: text and
 * thinking arrive *inside* `message_update`, and `message_update` is never
 * emitted for the end of a message -- the final state, with the stop reason and
 * the usage, comes as `message_end`.
 */
export function translatePiEvent(event: AgentSessionEvent): PiSignal | undefined {
  switch (event.type) {
    case 'message_update': {
      const inner = event.assistantMessageEvent;
      if (inner.type === 'text_delta') return { kind: 'text', text: inner.delta };
      if (inner.type === 'thinking_delta') return { kind: 'thinking', text: inner.delta };
      return undefined;
    }
    case 'message_end': {
      const message = event.message;
      if (message.role !== 'assistant') return undefined;
      return {
        kind: 'settled',
        stopReason: message.stopReason,
        message: message.errorMessage,
        usage: {
          inputTokens: message.usage.input,
          outputTokens: message.usage.output,
          cost: message.usage.cost.total,
        },
      };
    }
    case 'tool_execution_start':
      return { kind: 'tool-start', id: event.toolCallId, name: event.toolName, args: event.args };
    case 'tool_execution_update':
      return {
        kind: 'tool-update',
        id: event.toolCallId,
        name: event.toolName,
        snapshot: event.partialResult,
      };
    case 'tool_execution_end':
      return {
        kind: 'tool-end',
        id: event.toolCallId,
        name: event.toolName,
        result: event.result,
        isError: event.isError,
      };
    default:
      return undefined;
  }
}

/** The per-run state: what has been forwarded, what it cost, what went wrong. */
class RunTranslator {
  /** Output already forwarded, per tool call, so snapshots become deltas. */
  private readonly forwarded = new Map<string, string>();
  private total: TurnUsage | undefined;
  private reported: { code: string; message: string | undefined } | undefined;
  private lastStopReason = '';
  private lastErrorMessage: string | undefined;

  constructor(private readonly onEvent: (event: AgentEvent) => void) {}

  get usage(): TurnUsage | undefined {
    return this.total;
  }

  get failure(): { code: string; message: string | undefined } | undefined {
    return this.reported;
  }

  handle(event: AgentSessionEvent): void {
    const signal = translatePiEvent(event);
    if (signal === undefined) return;

    switch (signal.kind) {
      case 'text':
        this.onEvent({ kind: 'delta', text: signal.text });
        break;
      case 'thinking':
        this.onEvent({ kind: 'thinking', text: signal.text });
        break;
      case 'tool-start':
        this.forwarded.set(signal.id, '');
        this.onEvent({
          kind: 'tool',
          name: signal.name,
          status: 'start',
          detail: describeArgs(signal.args),
        });
        break;
      case 'tool-update': {
        const detail = this.advance(signal.id, signal.snapshot);
        if (detail.length > 0) {
          this.onEvent({ kind: 'tool', name: signal.name, status: 'output', detail });
        }
        break;
      }
      case 'tool-end': {
        const detail = this.advance(signal.id, signal.result);
        this.forwarded.delete(signal.id);
        this.onEvent({
          kind: 'tool',
          name: signal.name,
          status: signal.isError ? 'error' : 'done',
          detail,
        });
        break;
      }
      case 'settled':
        this.count(signal.usage);
        // Only remembered, not announced: pi retries a retryable failure by
        // itself, so a message that ended badly may still be followed by one
        // that ends well. The verdict waits for the run to be over.
        this.lastStopReason = signal.stopReason;
        this.lastErrorMessage = signal.message;
        break;
    }
  }

  /** The run is over: say whether it worked. */
  finish(aborted: boolean): void {
    if (aborted || this.lastStopReason === 'aborted') this.fail('aborted', undefined);
    else if (this.lastStopReason === 'error') this.fail('provider_error', this.lastErrorMessage);
  }

  /** Reports a failed run once; later ones are the same failure echoing. */
  fail(code: string, message: string | undefined): void {
    if (this.reported !== undefined) return;
    this.reported = { code, message };
    this.onEvent({ kind: 'error', code });
  }

  /** The part of this snapshot that has not been sent yet. */
  private advance(id: string, payload: unknown): string {
    const text = extractText(payload);
    const sent = this.forwarded.get(id) ?? '';
    this.forwarded.set(id, text);
    // Normally each snapshot extends the last. When it does not -- a truncated
    // output rewritten from the start, an error replacing the result -- sending
    // the whole thing is the honest fallback.
    return text.startsWith(sent) ? text.slice(sent.length) : text;
  }

  private count(usage: TurnUsage): void {
    // One run can span several model calls (a tool loop is at least two), and
    // every one of them is billed.
    this.total = {
      inputTokens: (this.total?.inputTokens ?? 0) + usage.inputTokens,
      outputTokens: (this.total?.outputTokens ?? 0) + usage.outputTokens,
      cost: (this.total?.cost ?? 0) + usage.cost,
    };
  }
}

/** The header line of a tool card: the command, the file, or the raw call. */
function describeArgs(args: unknown): string {
  if (typeof args !== 'object' || args === null) return '';
  const record = args as Record<string, unknown>;

  for (const key of ['command', 'path', 'file_path', 'filePath', 'url', 'query']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return `${value}\n`;
  }

  const json = JSON.stringify(record) ?? '';
  return json.length > 400 ? `${json.slice(0, 400)}…\n` : `${json}\n`;
}

/** Tool payloads are content blocks; the UI shows text. */
function extractText(payload: unknown): string {
  if (typeof payload === 'string') return payload;
  if (Array.isArray(payload)) return payload.map(extractText).join('');
  if (typeof payload !== 'object' || payload === null) return '';

  const record = payload as Record<string, unknown>;
  if (typeof record['text'] === 'string') return record['text'];
  if ('content' in record) return extractText(record['content']);
  if (typeof record['output'] === 'string') return record['output'];
  return '';
}

/** Engine failures the user can fix keep their code; the rest are bugs. */
function errorCode(error: unknown): string {
  if (error instanceof PiEngineError) return error.code;
  return 'operation_error';
}

function messageOf(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}
