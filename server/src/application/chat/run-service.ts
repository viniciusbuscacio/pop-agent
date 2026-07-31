import { DEFAULT_CHAT_TITLE, type Attachment, type ToolRecord } from '../../domain/chat/chat.js';
import { newMessageId, newRunId } from '../../domain/ids.js';
import { fallbackTitle } from '../../domain/chat/title.js';
import type { AgentBridge, AgentRunResult } from '../ports/agent-bridge.js';
import type { ChatRepo } from '../ports/chat-repo.js';
import type { Clock } from '../ports/clock.js';
import type { EventSink } from '../ports/event-sink.js';
import type { LlmRunsRepo } from '../ports/llm-runs-repo.js';

/**
 * Turning a typed message into a run, and a run into a stored answer
 * (docs/agent-flow.md).
 *
 * Two limits shape this. **One run per chat**, because a conversation with two
 * answers arriving at once is not a conversation. And a **global ceiling** on
 * how many talk to the engine at the same time -- twenty by default -- with
 * everything past it queued rather than refused, so opening a burst of chats
 * degrades into waiting instead of failing.
 *
 * Nothing here knows about HTTP or about pi: it drives the AgentBridge port
 * and announces what happens through the EventSink.
 */

export const DEFAULT_MAX_CONCURRENT_RUNS = 20;

/** A paused risky action denies itself after this long (popy.spec §10). */
export const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

export type StartRunResult =
  | { ok: true; runId: string; userMessageId: string }
  | { ok: false; reason: 'chat_not_found' | 'run_in_progress' };

export interface RunDeps {
  chats: ChatRepo;
  bridge: AgentBridge;
  sink: EventSink;
  clock: Clock;
  maxConcurrentRuns?: number;
  /** Overridable so tests do not wait five minutes for a denial. */
  confirmTimeoutMs?: number;
  /** Offered every finished run; decides by itself whether to rewrite. */
  titles?: { maybeRetitle(chatId: string): Promise<void> };
  /** Where what the run cost is written down (popy.spec §14). */
  llmRuns?: LlmRunsRepo;
  /** Told when a run finished, to push a notification (popy.spec §14). */
  notifyDone?: (info: { chatId: string; failed: boolean }) => void;
}

interface PendingRun {
  runId: string;
  chatId: string;
  prompt: string;
  model: string;
  attachments: Attachment[];
  controller: AbortController;
  started: boolean;
  /** Fragments emitted so far -- the sequence number of the last one. */
  seq: number;
  /** What has streamed so far, so a client mounting mid-run can catch up. */
  content: string;
  thinking: string;
  tools: ToolRecord[];
}

/** The run in flight for a chat, as the routes hand it to a mounting client. */
export interface LiveRunSnapshot {
  runId: string;
  status: 'queued' | 'running';
  seq: number;
  content: string;
  thinking: string;
  tools: ToolRecord[];
}

/**
 * Folds the events of one tool call into a single record: a call that starts,
 * streams six lines and exits is one thing that happened, not eight. The
 * client folds the live stream the same way, so a conversation reads
 * identically while it streams and after a reload.
 *
 * Details accumulate in order -- the command, then its output, then whatever
 * the closing event said -- because replacing them would throw away the output
 * the moment the call finished.
 */
function recordTool(
  tools: ToolRecord[],
  event: { name: string; status: ToolRecord['status']; detail: string },
): void {
  const last = tools[tools.length - 1];
  const finished = last?.status === 'done' || last?.status === 'error';

  if (event.status === 'start' || last === undefined || last.name !== event.name || finished) {
    tools.push({ name: event.name, status: event.status, detail: event.detail });
    return;
  }

  last.status = event.status;
  last.detail += event.detail;
}

interface PendingConfirm {
  resolve: (allow: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class RunService {
  private readonly runs = new Map<string, PendingRun>();
  private readonly runIdByChat = new Map<string, string>();
  private readonly queue: string[] = [];
  private readonly idleWaiters: (() => void)[] = [];
  /** Risky actions paused mid-run, keyed by runId, awaiting Allow/Deny. */
  private readonly confirms = new Map<string, PendingConfirm>();
  private running = 0;

  constructor(private readonly deps: RunDeps) {}

  private get ceiling(): number {
    return this.deps.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
  }

  /**
   * Persists the user's message and schedules the run, then returns: the
   * answer arrives over the event stream, not in this response.
   */
  startRun(chatId: string, text: string, attachments: Attachment[] = []): StartRunResult {
    const chat = this.deps.chats.get(chatId);
    if (chat === undefined) return { ok: false, reason: 'chat_not_found' };
    if (this.runIdByChat.has(chatId)) return { ok: false, reason: 'run_in_progress' };

    const now = new Date(this.deps.clock.now()).toISOString();
    const isFirstMessage = this.deps.chats.countMessages(chatId) === 0;

    const userMessage = this.deps.chats.appendMessage({
      id: newMessageId(),
      chatId,
      role: 'user',
      content: text,
      thinking: '',
      tools: [],
      attachments,
      createdAt: now,
    });
    this.deps.chats.touch(chatId, now);

    // A sidebar full of "New chat" is a sidebar you cannot read. Phase 3 lets
    // a model write this; until then the first message names the chat.
    if (isFirstMessage && chat.title === DEFAULT_CHAT_TITLE) {
      const title = fallbackTitle(text, this.deps.chats.titles());
      this.deps.chats.rename(chatId, title);
      this.deps.sink.emit({ kind: 'title', chatId, title });
    }

    const run: PendingRun = {
      runId: newRunId(),
      chatId,
      prompt: text,
      model: chat.model,
      attachments,
      controller: new AbortController(),
      started: false,
      seq: 0,
      content: '',
      thinking: '',
      tools: [],
    };
    this.runs.set(run.runId, run);
    this.runIdByChat.set(chatId, run.runId);

    if (this.running < this.ceiling) {
      void this.execute(run);
    } else {
      this.queue.push(run.runId);
      this.deps.sink.emit({ kind: 'run-status', chatId, runId: run.runId, status: 'queued' });
    }

    return { ok: true, runId: run.runId, userMessageId: userMessage.id };
  }

  /**
   * Answers a paused risky action. False when there was nothing waiting --
   * a stale card, or one another device already answered.
   */
  resolveConfirm(chatId: string, runId: string, allow: boolean): boolean {
    const run = this.runs.get(runId);
    if (run === undefined || run.chatId !== chatId) return false;
    const pending = this.confirms.get(runId);
    if (pending === undefined) return false;

    clearTimeout(pending.timer);
    this.confirms.delete(runId);
    pending.resolve(allow);
    return true;
  }

  /** Emits the confirm card and waits for an answer, or denies on timeout. */
  private askConfirm(
    run: PendingRun,
    question: { action: string; detail: string },
  ): Promise<boolean> {
    // A second question on a run that already has one pending cannot happen --
    // pi runs tools one at a time -- but if it did, the older one is denied.
    this.confirms.get(run.runId)?.resolve(false);

    this.deps.sink.emit({
      kind: 'confirm',
      chatId: run.chatId,
      runId: run.runId,
      action: question.action,
      detail: question.detail,
    });

    return new Promise<boolean>((resolve) => {
      const timeoutMs = this.deps.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS;
      const timer = setTimeout(() => {
        this.confirms.delete(run.runId);
        resolve(false); // silence is a denial
      }, timeoutMs);
      timer.unref?.();
      this.confirms.set(run.runId, { resolve, timer });
    });
  }

  /** Stops whatever this chat is doing. False when it was not doing anything. */
  stopRun(chatId: string): boolean {
    const runId = this.runIdByChat.get(chatId);
    if (runId === undefined) return false;
    const run = this.runs.get(runId);
    if (run === undefined) return false;

    if (run.started) {
      run.controller.abort();
      return true;
    }

    // Still queued: it never reached the engine, so there is nothing to abort
    // and no partial answer to keep. It is still reported as aborted, because
    // a client that asked for a stop needs to stop waiting.
    const queuedAt = this.queue.indexOf(runId);
    if (queuedAt >= 0) this.queue.splice(queuedAt, 1);
    this.runs.delete(runId);
    this.runIdByChat.delete(chatId);
    this.deps.sink.emit({ kind: 'error', chatId, runId, code: 'aborted' });
    this.settle();
    return true;
  }

  /** Resolves once nothing is running or waiting. Used by tests and shutdown. */
  whenIdle(): Promise<void> {
    if (this.isIdle()) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /**
   * What this chat's run has streamed so far, for a client that just mounted
   * (aw's partial-reply buffer). Undefined when nothing is in flight.
   */
  liveRun(chatId: string): LiveRunSnapshot | undefined {
    const runId = this.runIdByChat.get(chatId);
    if (runId === undefined) return undefined;
    const run = this.runs.get(runId);
    if (run === undefined) return undefined;

    return {
      runId: run.runId,
      status: run.started ? 'running' : 'queued',
      seq: run.seq,
      content: run.content,
      thinking: run.thinking,
      // Copied: the caller gets a snapshot, not a window into a moving run.
      tools: run.tools.map((tool) => ({ ...tool })),
    };
  }

  private async execute(run: PendingRun): Promise<void> {
    this.running += 1;
    run.started = true;
    const { chats, bridge, sink, clock } = this.deps;

    sink.emit({ kind: 'run-status', chatId: run.chatId, runId: run.runId, status: 'running' });

    let failure: string | undefined;
    let result: AgentRunResult = {};

    try {
      result = await bridge.run({
        chatId: run.chatId,
        prompt: run.prompt,
        model: run.model,
        attachments: run.attachments,
        confirm: (question) => this.askConfirm(run, question),
        signal: run.controller.signal,
        onEvent: (event) => {
          // Fragments accumulate on the run itself, so a client mounting
          // mid-run can be handed everything that already streamed
          // ({@link liveRun}); seq marks each one so nothing is counted twice.
          switch (event.kind) {
            case 'delta':
              run.content += event.text;
              run.seq += 1;
              sink.emit({
                kind: 'delta',
                chatId: run.chatId,
                runId: run.runId,
                seq: run.seq,
                text: event.text,
              });
              break;
            case 'thinking':
              run.thinking += event.text;
              run.seq += 1;
              sink.emit({
                kind: 'thinking',
                chatId: run.chatId,
                runId: run.runId,
                seq: run.seq,
                text: event.text,
              });
              break;
            case 'tool':
              recordTool(run.tools, event);
              run.seq += 1;
              sink.emit({
                kind: 'tool',
                chatId: run.chatId,
                runId: run.runId,
                seq: run.seq,
                name: event.name,
                status: event.status,
                detail: event.detail,
              });
              break;
            case 'error':
              // Recorded, not emitted yet: the terminal event goes out after
              // whatever did arrive has been saved.
              failure ??= event.code;
              break;
          }
        },
      });
    } catch {
      failure ??= 'operation_error';
    }

    const { content, thinking, tools } = run;

    const finishedAt = new Date(clock.now()).toISOString();

    // Booked before anything else: a failed run that reached the model was
    // still billed, and the numbers are the provider's own (spec §14).
    const usage = result.usage;
    if (usage !== undefined && this.deps.llmRuns !== undefined) {
      this.deps.llmRuns.record({
        id: run.runId,
        chatId: run.chatId,
        provider: usage.provider,
        model: usage.model,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        cost: usage.cost,
        createdAt: finishedAt,
      });
    }

    const somethingArrived = content.length > 0 || thinking.length > 0 || tools.length > 0;
    let messageId = '';

    // On success the message is always stored, so `done` can carry a real id.
    // On failure it is stored only if the answer had started -- a user who
    // watched half a reply appear should still find it after a reload.
    if (failure === undefined || somethingArrived) {
      messageId = chats.appendMessage({
        id: newMessageId(),
        chatId: run.chatId,
        role: 'assistant',
        content,
        thinking,
        tools,
        attachments: [],
        createdAt: finishedAt,
      }).id;
      chats.touch(run.chatId, finishedAt);
    }

    sink.emit(
      failure === undefined
        ? { kind: 'done', chatId: run.chatId, runId: run.runId, messageId }
        : { kind: 'error', chatId: run.chatId, runId: run.runId, code: failure },
    );

    // After the answer, never in its way: the title job is fire-and-forget,
    // and a run that failed does not deserve a fresher name.
    if (failure === undefined && this.deps.titles !== undefined) {
      this.deps.titles.maybeRetitle(run.chatId).catch(() => undefined);
    }
    // A push so the phone hears about it with the PWA closed (popy.spec §14).
    this.deps.notifyDone?.({ chatId: run.chatId, failed: failure !== undefined });

    this.finish(run);
  }

  private finish(run: PendingRun): void {
    this.running -= 1;
    this.runs.delete(run.runId);
    this.runIdByChat.delete(run.chatId);
    // A run that ended with a question still open denies it, so nothing leaks.
    const pending = this.confirms.get(run.runId);
    if (pending !== undefined) {
      clearTimeout(pending.timer);
      this.confirms.delete(run.runId);
      pending.resolve(false);
    }
    this.drain();
    this.settle();
  }

  private drain(): void {
    while (this.running < this.ceiling && this.queue.length > 0) {
      const runId = this.queue.shift();
      if (runId === undefined) return;
      const next = this.runs.get(runId);
      if (next !== undefined) void this.execute(next);
    }
  }

  private isIdle(): boolean {
    return this.running === 0 && this.queue.length === 0 && this.runs.size === 0;
  }

  private settle(): void {
    if (!this.isIdle()) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}
