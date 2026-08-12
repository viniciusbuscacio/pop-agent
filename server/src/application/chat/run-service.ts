import {
  type Attachment,
  type Message,
  type MessageClient,
  type ToolRecord,
} from '../../domain/chat/chat.js';
import { newMessageId, newRunId } from '../../domain/ids.js';
import { fallbackTitle, isGenericTitle } from '../../domain/chat/title.js';
import type {
  AgentBridge,
  AgentRunControl,
  AgentRunResult,
} from '../ports/agent-bridge.js';
import type { ChatRepo } from '../ports/chat-repo.js';
import type { Clock } from '../ports/clock.js';
import type { EventSink } from '../ports/event-sink.js';
import type { LlmRunsRepo } from '../ports/llm-runs-repo.js';
import { billsPerToken } from '../providers/provider-definitions.js';
import { channelNote } from './channel-note.js';
import { shouldFailOver, isAuthFailure, type RunFailure } from './failover.js';

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

/** A paused risky action denies itself after this long (pop-agent.spec §10). */
export const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

/** Per-run knobs. Everything absent is the ordinary chat behaviour. */
export interface StartRunOptions {
  /**
   * Push a notification when this run finishes. Default true. A background
   * task whose notification is switched off passes false (pop-agent.spec §21) --
   * a task on a ten-minute interval is otherwise a phone buzzing every ten
   * minutes.
   */
  notify?: boolean;
  /**
   * Which client sent this, recorded on the message (pop-agent.spec §13). The
   * `ip` half is stored and never reaches the model: it answers "who
   * connected", which is an audit question, and no answer of hers would
   * change because of it.
   */
  client?: MessageClient;
  /**
   * The terminal that typed this message, when one did (docs/cli.md, Whose
   * local connections). It rides on the MESSAGE and not on the chat: a laptop that is
   * shut must never be reachable through a message sent from the phone, and
   * a chat answered from two machines has to stay legible when read back.
   *
   * Fixed here and never revisited -- attaching or detaching a terminal
   * later does not reach into a run already in flight.
   */
  localConnectionId?: string;
}

export type StartRunResult =
  | { ok: true; runId: string; userMessageId: string }
  | {
      ok: false;
      reason: 'chat_not_found' | 'run_in_progress' | 'llm_stopped' | 'deployment_pending';
    };

/**
 * How a run ended, for whoever asked to be told ({@link RunService.whenRunEnds}).
 * The background-task scheduler is the caller: it writes the code down as the
 * task's last status (pop-agent.spec §21).
 */
export type RunOutcome = { ok: true } | { ok: false; code: string };

/** Outcomes kept for a run nobody was waiting on yet, so a fast finish is not lost. */
const REMEMBERED_OUTCOMES = 50;

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
  /** Where what the run cost is written down (pop-agent.spec §14). */
  llmRuns?: LlmRunsRepo;
  /**
   * Told when a run finished, to push a notification (pop-agent.spec §14) and to
   * count the run for health. `notify` false means only the push is skipped --
   * a background task with its notification switched off (§21) still happened.
   */
  notifyDone?: (info: {
    chatId: string;
    failed: boolean;
    notify: boolean;
    code?: string;
  }) => void;
  /** Accepted user work resets the quiet period before an automatic deployment. */
  onActivity?: () => void;
  /** Told after a run's messages are stored, to embed them (pop-agent.spec §7). */
  indexMessages?: () => void;
  /**
   * Told when a run's work is over, with when it began (epoch ms). The
   * provenance walk hangs off this (pop-agent.spec §14): files under Files/
   * touched during the window are logged as written by this chat.
   */
  onRunFinished?: (info: { chatId: string; startedAtMs: number }) => void;
  /**
   * The ordered failover chain for a run (pop-agent.spec §15, fase 2): every
   * usable (provider, model) pair, the chat's override first. Absent -- the
   * fixture-less tests -- means one attempt with the chat's own pair, which
   * is exactly the phase-1 behaviour.
   */
  resolveChain?: (override: {
    provider: string;
    model: string;
  }) => { providerId: string; modelId: string }[];
  /** The advisory cooldown a failing provider is penalized into. */
  cooldown?: { penalize(providerId: string): void; clear(providerId: string): void };
  /** The journal line when a run fails over; main.ts logs it. */
  onFallback?: (info: { chatId: string; from: string; to: string; code: string }) => void;
  /** Auth-class refusals, forwarded to the provider layer (pop-agent.spec §15). */
  onAuthFailure?: (providerId: string) => void;
  /** Called after a chat leaves the run registry, so its durable follow-up may start. */
  onRunSettled?: (chatId: string) => void;
  /** The bridge can now accept a durable steering input for this live run. */
  onRunSteerable?: (chatId: string) => void;
  /** A durable steering input entered pi's transcript and can leave the queue table. */
  onSteeringDelivered?: (chatId: string, steeringId: string) => void;
  /** Called when the operator re-enables work, to recover persisted follow-ups. */
  onLlmStarted?: () => void;
}

interface PendingSteering {
  id: string;
  text: string;
  prompt: string;
  attachments: Attachment[];
  client?: MessageClient;
  localConnectionId?: string;
}

interface PendingRun {
  runId: string;
  chatId: string;
  prompt: string;
  model: string;
  provider: string;
  attachments: Attachment[];
  controller: AbortController;
  /** False silences the finished-run push for this run alone (pop-agent.spec §21). */
  notify: boolean;
  /** The terminal whose local connection this run has, if its message named one. */
  localConnectionId: string | undefined;
  /** Controls the concrete bridge attempt currently using this run. */
  control: AgentRunControl | undefined;
  /** Durable steering inputs already offered to pi, keyed by queue id. */
  steering: Map<string, PendingSteering>;
  started: boolean;
  /** Epoch ms when execution began; 0 while still queued. */
  startedAtMs: number;
  /** Fragments emitted so far -- the sequence number of the last one. */
  seq: number;
  /** What has streamed so far, so a client mounting mid-run can catch up. */
  content: string;
  thinking: string;
  tools: ToolRecord[];
}

export interface SteeringInput {
  id: string;
  text: string;
  attachments: Attachment[];
  client?: MessageClient;
  localConnectionId?: string;
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
  /** Who asked to be told when a run ends, and the outcomes nobody claimed. */
  private readonly runWaiters = new Map<string, ((outcome: RunOutcome) => void)[]>();
  private readonly endedRuns = new Map<string, RunOutcome>();
  private running = 0;
  /**
   * The operator's "Stop LLM" switch (Settings → Server, LOTE 6): while set,
   * new runs are refused with a persisted error and nothing reaches the
   * engine. The web/API keep working; only the brain is off.
   */
  private llmHalted = false;
  /** Separate from the operator switch: cancelling a deployment must not start a stopped LLM. */
  private deploymentDraining = false;

  constructor(private readonly deps: RunDeps) {}

  private get ceiling(): number {
    return this.deps.maxConcurrentRuns ?? DEFAULT_MAX_CONCURRENT_RUNS;
  }

  /**
   * Persists the user's message and schedules the run, then returns: the
   * answer arrives over the event stream, not in this response.
   *
   * `options.notify` is the one thing a caller may turn off: a background task
   * with its notification switched off still runs exactly like any other run,
   * it just does not reach for the phone at the end (pop-agent.spec §21).
   */
  startRun(
    chatId: string,
    text: string,
    attachments: Attachment[] = [],
    options: StartRunOptions = {},
  ): StartRunResult {
    const chat = this.deps.chats.get(chatId);
    if (chat === undefined) return { ok: false, reason: 'chat_not_found' };
    if (this.runIdByChat.has(chatId)) return { ok: false, reason: 'run_in_progress' };
    // The HTTP layer turns this into the durable queue; no words are persisted twice here.
    if (this.deploymentDraining) return { ok: false, reason: 'deployment_pending' };
    this.deps.onActivity?.();

    const now = new Date(this.deps.clock.now()).toISOString();
    const isFirstMessage = this.deps.chats.countMessages(chatId) === 0;

    // Refused, but not silently: the user's words and the reason nothing
    // answered are both history now (the flag is deliberate, not a crash).
    if (this.llmHalted) {
      this.deps.chats.appendMessage({
        id: newMessageId(),
        chatId,
        role: 'user',
        content: text,
        thinking: '',
        tools: [],
        attachments,
        createdAt: now,
      });
      this.deps.chats.appendMessage({
        id: newMessageId(),
        chatId,
        role: 'system',
        content: 'LLM stopped by operator. Start it again in Settings → Server.',
        thinking: '',
        tools: [],
        attachments: [],
        createdAt: now,
      });
      this.deps.chats.touch(chatId, now);
      return { ok: false, reason: 'llm_stopped' };
    }

    // What the last message came through, read BEFORE this one is stored:
    // the agent is told only when the channel changes, because repeating
    // "this came from the CLI" on all fifty turns of a conversation is fifty
    // copies of a fact that mattered once (Vinicius, 04/08).
    const previousClient = this.deps.chats.lastClientKind(chatId);

    const userMessage = this.deps.chats.appendMessage({
      id: newMessageId(),
      chatId,
      role: 'user',
      content: text,
      thinking: '',
      tools: [],
      attachments,
      createdAt: now,
      ...(options.client === undefined ? {} : { client: options.client }),
    });
    this.deps.chats.touch(chatId, now);

    // A sidebar full of "New chat" is a sidebar you cannot read. Phase 3 lets
    // a model write this; until then the first message names the chat.
    //
    // `autoTitle` is the same veto the service model respects (pop-agent.spec §14):
    // a name chosen by hand is not the machine's to improve on, and a
    // background task's chat is named after the task before its first message
    // ever arrives (§21) -- even when the task is called "Chat 4".
    if (isFirstMessage && chat.autoTitle && isGenericTitle(chat.title)) {
      const title = fallbackTitle(text, this.deps.chats.titles());
      this.deps.chats.rename(chatId, title);
      this.deps.chats.recordTitle({
        chatId,
        title,
        turn: 1,
        source: 'auto',
        createdAt: now,
      });
      this.deps.sink.emit({ kind: 'title', chatId, title });
    }

    const note = channelNote(options.client, previousClient);

    const run: PendingRun = {
      runId: newRunId(),
      chatId,
      // The note rides this turn's prompt only; the stored message keeps the
      // user's own words, so the history is not littered with framing.
      prompt: note === undefined ? text : `${note}\n\n${text}`,
      model: chat.model,
      provider: chat.provider,
      attachments,
      controller: new AbortController(),
      notify: options.notify ?? true,
      localConnectionId: options.localConnectionId,
      control: undefined,
      steering: new Map(),
      started: false,
      startedAtMs: 0,
      seq: 0,
      content: '',
      thinking: '',
      tools: [],
    };
    this.runs.set(run.runId, run);
    this.runIdByChat.set(chatId, run.runId);
    // Broadcast the persisted user turn before any status or fragment. That
    // lets a terminal already watching this chat adopt a run started on the
    // web (and vice versa) without polling or inventing message contents.
    this.deps.sink.emit({
      kind: 'run-started',
      chatId,
      runId: run.runId,
      user: userMessage,
    });

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

  /**
   * Resolves when this run ends, with how it ended (pop-agent.spec §21). The
   * scheduler needs a run's outcome, not just its events, and an SSE sink is
   * a broadcast rather than an answer to one question.
   *
   * A run that finished before anyone asked is still answerable: the last few
   * outcomes are remembered, which covers the case of a bridge that refuses
   * synchronously and so ends the run inside `startRun` itself.
   */
  whenRunEnds(runId: string): Promise<RunOutcome> {
    const ended = this.endedRuns.get(runId);
    if (ended !== undefined) {
      this.endedRuns.delete(runId);
      return Promise.resolve(ended);
    }
    return new Promise<RunOutcome>((resolve) => {
      const waiters = this.runWaiters.get(runId);
      if (waiters === undefined) this.runWaiters.set(runId, [resolve]);
      else waiters.push(resolve);
    });
  }

  /** Tells everyone waiting on a run how it went, or remembers it briefly. */
  private endRun(runId: string, outcome: RunOutcome): void {
    const waiters = this.runWaiters.get(runId);
    if (waiters !== undefined) {
      this.runWaiters.delete(runId);
      for (const resolve of waiters) resolve(outcome);
      return;
    }
    this.endedRuns.set(runId, outcome);
    // Bounded: this is a convenience for a caller that may never come, not a
    // log. The oldest entry goes when the map grows past the ceiling.
    if (this.endedRuns.size > REMEMBERED_OUTCOMES) {
      const oldest = this.endedRuns.keys().next().value;
      if (oldest !== undefined) this.endedRuns.delete(oldest);
    }
  }

  /**
   * Everything this chat has in flight, gone (pop-agent.spec §6). A started run is
   * aborted -- which reaches all the way down to pi killing the engine's
   * process group -- and anything of this chat still waiting for a slot is
   * dropped without ever reaching the engine.
   *
   * This is what a delete calls before the rows go: a run that kept streaming
   * into a conversation that no longer exists would be work nobody can read,
   * paid for out of the user's own credit.
   */
  discardChat(chatId: string): boolean {
    let discarded = this.stopRun(chatId);

    // Defensive sweep: one chat has one run today, but a queued straggler
    // must not survive the conversation it belongs to.
    for (const run of [...this.runs.values()]) {
      if (run.chatId !== chatId || run.started) continue;
      const queuedAt = this.queue.indexOf(run.runId);
      if (queuedAt >= 0) this.queue.splice(queuedAt, 1);
      this.runs.delete(run.runId);
      this.runIdByChat.delete(chatId);
      this.deps.sink.emit({ kind: 'error', chatId, runId: run.runId, code: 'aborted' });
      this.endRun(run.runId, { ok: false, code: 'aborted' });
      discarded = true;
    }

    if (discarded) this.settle();
    return discarded;
  }

  /** Whether the operator has the LLM switched off. */
  isLlmStopped(): boolean {
    return this.llmHalted;
  }

  /** Whether a durable queued message may enter the runtime right now. */
  isAcceptingRuns(): boolean {
    return !this.llmHalted && !this.deploymentDraining;
  }

  /**
   * "Stop LLM" (LOTE 6): aborts every run in flight, drops the queue, and
   * refuses anything new until {@link startLlm}. Returns how many chats were
   * interrupted. Each aborted run still persists its partial answer through
   * the normal failure path.
   */
  stopLlm(): number {
    this.llmHalted = true;
    const chatIds = [...this.runIdByChat.keys()];
    for (const chatId of chatIds) this.stopRun(chatId);
    return chatIds.length;
  }

  /** Clears the operator switch; sessions are recreated lazily by the bridge. */
  startLlm(): void {
    this.llmHalted = false;
    this.deps.onLlmStarted?.();
  }

  /**
   * Deployment drain: refuse new work without aborting what is already running.
   * Unlike stopLlm(), this is patient -- the supervisor is not allowed to
   * restart until whenIdle resolves and every current answer is persisted.
   */
  quiesce(): void {
    this.beginDeploymentDrain();
  }

  beginDeploymentDrain(): void {
    this.deploymentDraining = true;
  }

  endDeploymentDrain(): void {
    if (!this.deploymentDraining) return;
    this.deploymentDraining = false;
    this.deps.onLlmStarted?.();
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
    this.endRun(runId, { ok: false, code: 'aborted' });
    this.settle();
    return true;
  }

  /** True only when the message can safely share the live session's tools. */
  canSteer(chatId: string, localConnectionId: string | undefined): boolean {
    const runId = this.runIdByChat.get(chatId);
    const run = runId === undefined ? undefined : this.runs.get(runId);
    return (
      run !== undefined &&
      run.started &&
      run.localConnectionId === localConnectionId
    );
  }

  /** Offers one durable FIFO item to the bridge; several may coexist by id. */
  offerSteering(chatId: string, input: SteeringInput): boolean {
    const runId = this.runIdByChat.get(chatId);
    const run = runId === undefined ? undefined : this.runs.get(runId);
    if (
      run === undefined ||
      !run.started ||
      run.localConnectionId !== input.localConnectionId ||
      run.control === undefined
    ) {
      return false;
    }
    if (run.steering.has(input.id)) return true;

    const previousClient = this.deps.chats.lastClientKind(chatId);
    const note = channelNote(input.client, previousClient);
    const steering: PendingSteering = {
      ...input,
      prompt: note === undefined ? input.text : `${note}\n\n${input.text}`,
    };
    run.steering.set(input.id, steering);
    const control = run.control;
    void control
      .steer({ id: input.id, prompt: steering.prompt, attachments: input.attachments })
      .then((accepted) => {
        if (!accepted) run.steering.delete(input.id);
      })
      .catch(() => {
        run.steering.delete(input.id);
      });
    return true;
  }

  /** Removes a not-yet-delivered intervention before the durable row is edited/deleted. */
  cancelSteering(chatId: string, steeringId: string): boolean {
    const runId = this.runIdByChat.get(chatId);
    const run = runId === undefined ? undefined : this.runs.get(runId);
    if (run === undefined || !run.steering.has(steeringId)) return false;
    run.control?.cancelSteering(steeringId);
    run.steering.delete(steeringId);
    return true;
  }

  /** Clears pi's live steering queue so SQLite can rebuild the exact FIFO. */
  clearSteering(chatId: string): boolean {
    const runId = this.runIdByChat.get(chatId);
    const run = runId === undefined ? undefined : this.runs.get(runId);
    if (run === undefined || run.steering.size === 0) return false;
    run.control?.clearSteering();
    run.steering.clear();
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

  /**
   * Persists every in-flight run's partial answer, for the moment the process
   * is told to die: a watched half-reply must be on disk after the restart,
   * not gone (Vinicius, 31/07). Synchronous on purpose -- better-sqlite3
   * writes complete inside a signal handler. Buffers are cleared so a run
   * that somehow still finishes cannot store the same words twice.
   */
  flushInterrupted(): void {
    for (const run of this.runs.values()) {
      const somethingArrived =
        run.content.length > 0 || run.thinking.length > 0 || run.tools.length > 0;
      if (!run.started || !somethingArrived) continue;
      const at = new Date(this.deps.clock.now()).toISOString();
      this.deps.chats.appendMessage({
        id: newMessageId(),
        chatId: run.chatId,
        role: 'assistant',
        content: `${run.content}\n\n*— interrupted by a server restart —*`,
        thinking: run.thinking,
        tools: run.tools,
        attachments: [],
        createdAt: at,
      });
      this.deps.chats.touch(run.chatId, at);
      run.content = '';
      run.thinking = '';
      run.tools = [];
    }
  }

  /**
   * One attempt against one provider. The failure comes back typed (code +
   * status where the adapter could tell) so the failover loop can classify
   * it; the attempt's usage is booked here, because a failed attempt that
   * reached the model was still billed (spec §14).
   */
  private async attempt(
    run: PendingRun,
    pair: { providerId: string; modelId: string },
    attemptIndex: number,
  ): Promise<RunFailure | undefined> {
    const { bridge, sink, clock } = this.deps;
    let failure: RunFailure | undefined;
    let result: AgentRunResult = {};

    try {
      result = await bridge.run({
        chatId: run.chatId,
        prompt: run.prompt,
        model: pair.modelId,
        provider: pair.providerId,
        attachments: run.attachments,
        ...(run.localConnectionId === undefined
          ? {}
          : { localConnectionId: run.localConnectionId }),
        confirm: (question) => this.askConfirm(run, question),
        onControlReady: (control) => {
          run.control = control;
          this.deps.onRunSteerable?.(run.chatId);
        },
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
            case 'steering-delivered':
              this.acceptDeliveredSteering(run, event.steeringId);
              break;
            case 'error':
              // Recorded, not emitted yet: the terminal event goes out after
              // whatever did arrive has been saved.
              failure ??= {
                code: event.code,
                ...(event.status === undefined ? {} : { status: event.status }),
              };
              break;
          }
        },
      });
    } catch {
      failure ??= { code: 'operation_error' };
    } finally {
      run.control = undefined;
    }

    const usage = result.usage;
    if (usage !== undefined && this.deps.llmRuns !== undefined) {
      this.deps.llmRuns.record({
        // The first attempt keeps the run id; a failover attempt gets its own
        // suffixed row -- both were billed, and llm_runs ids are unique.
        id: attemptIndex === 0 ? run.runId : `${run.runId}-f${String(attemptIndex)}`,
        chatId: run.chatId,
        provider: usage.provider,
        model: usage.model,
        tokensIn: usage.inputTokens,
        tokensOut: usage.outputTokens,
        // A subscription bills nothing per token, whatever the catalogue says.
        // The token counts stay: they are true either way, and they are what
        // makes a subscription's usage comparable to a paid one's.
        cost: billsPerToken(usage.provider) ? usage.cost : 0,
        createdAt: new Date(clock.now()).toISOString(),
      });
    }

    return failure;
  }

  /** Splits the persisted/UI transcript exactly where pi inserts a steering user turn. */
  private acceptDeliveredSteering(run: PendingRun, steeringId: string): void {
    const steering = run.steering.get(steeringId);
    if (steering === undefined) return;

    const createdAt = new Date(this.deps.clock.now()).toISOString();
    const hasAssistant =
      run.content.length > 0 || run.thinking.length > 0 || run.tools.length > 0;
    const assistant: Message | undefined = hasAssistant
      ? this.deps.chats.appendMessage({
          id: newMessageId(),
          chatId: run.chatId,
          role: 'assistant',
          content: run.content,
          thinking: run.thinking,
          tools: run.tools,
          attachments: [],
          createdAt,
        })
      : undefined;
    const user = this.deps.chats.appendMessage({
      id: newMessageId(),
      chatId: run.chatId,
      role: 'user',
      content: steering.text,
      thinking: '',
      tools: [],
      attachments: steering.attachments,
      createdAt,
      ...(steering.client === undefined ? {} : { client: steering.client }),
    });
    this.deps.chats.touch(run.chatId, createdAt);

    run.content = '';
    run.thinking = '';
    run.tools = [];
    run.steering.delete(steeringId);
    this.deps.onSteeringDelivered?.(run.chatId, steeringId);
    this.deps.sink.emit({
      kind: 'steering-delivered',
      chatId: run.chatId,
      runId: run.runId,
      seq: run.seq,
      ...(assistant === undefined ? {} : { assistant }),
      user,
    });
  }

  private async execute(run: PendingRun): Promise<void> {
    this.running += 1;
    run.started = true;
    const { chats, sink, clock } = this.deps;
    run.startedAtMs = clock.now();

    sink.emit({ kind: 'run-status', chatId: run.chatId, runId: run.runId, status: 'running' });

    // The failover chain (pop-agent.spec §15, fase 2): every usable pair in
    // resolution order, or -- without the resolver -- one attempt with the
    // chat's own pair, exactly the old behaviour.
    const chain = this.deps.resolveChain?.({ provider: run.provider, model: run.model }) ?? [
      { providerId: run.provider, modelId: run.model },
    ];

    let failure: RunFailure | undefined;
    let lastPair: { providerId: string; modelId: string } | undefined;

    for (let index = 0; index < chain.length; index += 1) {
      const pair = chain[index];
      if (pair === undefined) break;
      lastPair = pair;

      failure = await this.attempt(run, pair, index);
      if (failure === undefined) {
        this.deps.cooldown?.clear(pair.providerId);
        break; // answered
      }
      if (isAuthFailure(failure)) this.deps.onAuthFailure?.(pair.providerId);
      if (failure.code === 'aborted' || run.controller.signal.aborted) break;

      // A failover-class refusal penalizes the provider whether or not the
      // run can move on -- the next chains skip it for a few minutes.
      const failover = shouldFailOver(failure);
      if (failover) this.deps.cooldown?.penalize(pair.providerId);

      const next = chain[index + 1];
      // Tokens, thinking, or tools already rendered must not be retried under
      // the reader: a run that streamed any visible answer fails in place, and
      // re-executing tools on another provider would double side effects.
      if (
        !failover ||
        next === undefined ||
        run.content.length > 0 ||
        run.thinking.length > 0 ||
        run.tools.length > 0
      ) {
        break;
      }

      // Loud, and in the history: the reader of this chat deserves to know
      // the answer came from somewhere else, today and after every reload.
      const fallbackMessage = chats.appendMessage({
        id: newMessageId(),
        chatId: run.chatId,
        role: 'system',
        content: `Answer retried via ${next.providerId} after ${pair.providerId} failed (${failure.code}).`,
        thinking: '',
        tools: [],
        attachments: [],
        createdAt: new Date(clock.now()).toISOString(),
        notice: {
          kind: 'model-fallback',
          failed: {
            providerId: pair.providerId,
            modelId: pair.modelId,
            code: failure.code,
            ...(failure.status === undefined ? {} : { status: failure.status }),
          },
          fallback: { providerId: next.providerId, modelId: next.modelId },
        },
      });
      sink.emit({
        kind: 'system-message',
        chatId: run.chatId,
        runId: run.runId,
        message: fallbackMessage,
      });
      this.deps.onFallback?.({
        chatId: run.chatId,
        from: pair.providerId,
        to: next.providerId,
        code: failure.code,
      });
    }

    const { content, thinking, tools } = run;

    const finishedAt = new Date(clock.now()).toISOString();

    const somethingArrived = content.length > 0 || thinking.length > 0 || tools.length > 0;
    let messageId = '';

    // The conversation may have been deleted while this ran (pop-agent.spec §6):
    // the delete aborts the run first, but the abort unwinds asynchronously
    // and lands here. There is nowhere to store an answer, and writing one
    // would fail the foreign key -- so the run just ends.
    if (chats.get(run.chatId) === undefined) {
      sink.emit({ kind: 'error', chatId: run.chatId, runId: run.runId, code: 'aborted' });
      this.endRun(run.runId, { ok: false, code: 'aborted' });
      this.finish(run);
      return;
    }

    // On success the message is always stored, so `done` can carry a real id.
    // On failure a partial answer is still stored -- a user who watched half
    // a reply appear should find it after a reload.
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
    }
    // EVERY failure also leaves a persisted system message (pop-agent.spec §6): an
    // error that existed only as an SSE event vanishes on reload, and the
    // user who saw it can no longer ask "what happened?". History is forever.
    let failureMessage: Message | undefined;
    if (failure !== undefined) {
      failureMessage = chats.appendMessage({
        id: newMessageId(),
        chatId: run.chatId,
        role: 'system',
        content:
          failure.code === 'aborted'
            ? 'You stopped this answer.'
            : `That answer could not be finished. (${failure.code})`,
        thinking: '',
        tools: [],
        attachments: [],
        createdAt: finishedAt,
        ...(failure.code === 'aborted' || lastPair === undefined
          ? {}
          : {
              notice: {
                kind: 'run-failure',
                failed: {
                  providerId: lastPair.providerId,
                  modelId: lastPair.modelId,
                  code: failure.code,
                  ...(failure.status === undefined ? {} : { status: failure.status }),
                },
              },
            }),
      });
    }
    // A message was always appended (the answer, or the error mark).
    chats.touch(run.chatId, finishedAt);

    sink.emit(
      failure === undefined
        ? { kind: 'done', chatId: run.chatId, runId: run.runId, messageId }
        : {
            kind: 'error',
            chatId: run.chatId,
            runId: run.runId,
            code: failure.code,
            ...(failureMessage === undefined ? {} : { message: failureMessage }),
          },
    );

    // After the answer, never in its way: the title job is fire-and-forget,
    // and a run that failed does not deserve a fresher name.
    if (failure === undefined && this.deps.titles !== undefined) {
      this.deps.titles.maybeRetitle(run.chatId).catch(() => undefined);
    }
    // A push so the phone hears about it with the PWA closed (pop-agent.spec §14).
    // `notify` is carried rather than obeyed here: this hook is also where the
    // run is counted for health, and a quiet task is still a run that happened.
    this.deps.notifyDone?.({
      chatId: run.chatId,
      failed: failure !== undefined,
      notify: run.notify,
      ...(failure === undefined ? {} : { code: failure.code }),
    });
    // Embed the new messages for semantic memory, off the reply path (§7).
    this.deps.indexMessages?.();
    // The provenance walk (§14): what this run left under Files/ is history now.
    this.deps.onRunFinished?.({ chatId: run.chatId, startedAtMs: run.startedAtMs });

    // And whoever asked in code rather than over the stream (pop-agent.spec §21).
    this.endRun(
      run.runId,
      failure === undefined ? { ok: true } : { ok: false, code: failure.code },
    );

    this.finish(run);
  }

  private finish(run: PendingRun): void {
    this.running -= 1;
    this.runs.delete(run.runId);
    this.runIdByChat.delete(run.chatId);
    this.deps.onRunSettled?.(run.chatId);
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
