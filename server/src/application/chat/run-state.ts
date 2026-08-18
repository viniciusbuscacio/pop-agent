import type { Attachment, ExecutionMode, MessageClient, ToolRecord } from '../../domain/chat/chat.js';
import type { AgentBridge, AgentRunControl } from '../ports/agent-bridge.js';
import type { ChatRepo } from '../ports/chat-repo.js';
import type { Clock } from '../ports/clock.js';
import type { EventSink } from '../ports/event-sink.js';
import type { LlmRunsRepo } from '../ports/llm-runs-repo.js';

export const DEFAULT_MAX_CONCURRENT_RUNS = 20;

/** A paused risky action denies itself after this long (docs/specs/Spec-Pop-General.md §10). */
export const CONFIRM_TIMEOUT_MS = 5 * 60 * 1000;

/** Per-run knobs. Everything absent is the ordinary chat behaviour. */
export interface StartRunOptions {
  /**
   * Push a notification when this run finishes. Default true. A background
   * task whose notification is switched off passes false (docs/specs/Spec-Pop-General.md §21) --
   * a task on a ten-minute interval is otherwise a phone buzzing every ten
   * minutes.
   */
  notify?: boolean;
  /**
   * Which client sent this, recorded on the message (docs/specs/Spec-Pop-General.md §13). The
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
  /** Defaults to normal; fixed for the whole concrete pi run. */
  executionMode?: ExecutionMode;
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
 * task's last status (docs/specs/Spec-Pop-General.md §21).
 */
export type RunOutcome = { ok: true } | { ok: false; code: string };

/** Outcomes kept for a run nobody was waiting on yet, so a fast finish is not lost. */
export const REMEMBERED_OUTCOMES = 50;

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
  /** Where what the run cost is written down (docs/specs/Spec-Pop-General.md §14). */
  llmRuns?: LlmRunsRepo;
  /**
   * Told when a run finished, to push a notification (docs/specs/Spec-Pop-General.md §14) and to
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
  /** Told after a run's messages are stored, to embed them (docs/specs/Spec-Pop-General.md §7). */
  indexMessages?: () => void;
  /**
   * Told when a run's work is over, with when it began (epoch ms). The
   * provenance walk hangs off this (docs/specs/Spec-Pop-General.md §14): files under Files/
   * touched during the window are logged as written by this chat.
   */
  onRunFinished?: (info: { chatId: string; startedAtMs: number }) => void;
  /**
   * The ordered failover chain for a run (docs/specs/Spec-Pop-General.md §15, fase 2): every
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
  /** Auth-class refusals, forwarded to the provider layer (docs/specs/Spec-Pop-General.md §15). */
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

export interface PendingSteering {
  id: string;
  text: string;
  prompt: string;
  attachments: Attachment[];
  client?: MessageClient;
  localConnectionId?: string;
}

export interface PendingRun {
  runId: string;
  chatId: string;
  prompt: string;
  model: string;
  provider: string;
  attachments: Attachment[];
  controller: AbortController;
  /** False silences the finished-run push for this run alone (docs/specs/Spec-Pop-General.md §21). */
  notify: boolean;
  /** The terminal whose local connection this run has, if its message named one. */
  localConnectionId: string | undefined;
  executionMode: ExecutionMode;
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
  executionMode?: ExecutionMode;
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
export function recordTool(
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

export interface PendingConfirm {
  resolve: (allow: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}
