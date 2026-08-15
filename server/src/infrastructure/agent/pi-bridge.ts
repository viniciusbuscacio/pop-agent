import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Attachment } from '../../domain/chat/chat.js';
import type {
  AgentBridge,
  AgentEvent,
  AgentRunRequest,
  AgentRunResult,
  EngineCompletionRequest,
  ModelInfo,
  ProviderAuthBridge,
  ProviderAuthInteraction,
  ProviderSubscriptionUsage,
  RunUsage,
} from '../../application/ports/agent-bridge.js';
import type { ChatRepo } from '../../application/ports/chat-repo.js';
import {
  DEFAULT_MODEL_ID,
  PROVIDER_ID,
  PiEngineError,
  type PiEngine,
  type PiImage,
  type PiSession,
} from './pi-engine.js';
import { TaintGuard } from './tool-taint.js';
import { shouldFailOver } from '../../application/chat/failover.js';

/**
 * pi behind the AgentBridge port (pop-agent.spec §5, docs/agent-flow.md).
 *
 * It is the same port the scripted fake implements, and the application layer
 * did not change by a line to accept it -- which was the point of building
 * Phase 2 against a fake in the first place.
 *
 * Two things live here that the port cannot express:
 *
 * - **A session per conversation.** pi keeps the execution state (the context
 *   the model actually sees) in its own JSONL file; Pop Agent keeps the product
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
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** US dollars, as reported by pi's catalog pricing. */
  cost: number;
}

export interface PiBridgeDeps {
  chats: ChatRepo;
  engine: PiEngine;
  /** Where attached files are written so the agent's tools can open them. */
  workspace?: string;
  /** The Skill Router: the relevant skills for a message, as prompt blocks. */
  skillsFor?: (message: string) => Promise<string[]>;
  /**
   * Resolves the pair that should actually run (pop-agent.spec §15): the chat's
   * override when usable, the global default otherwise, with silent
   * degradation and the never-empty election inside. Read per run.
   */
  resolvePair?: (provider: string, model: string) => { providerId: string; modelId: string };
  /** The user's custom instructions. Read per run, same reason. */
  instructions?: () => string;
  /** Overridable so tests do not wait three hours. */
  idleMs?: number;
  onUsage?: (usage: PiRunUsage) => void;
  /**
   * The wire carries a stable code and nothing else (pop-agent.spec §13), which is
   * right for the UI and useless for whoever has to explain why a run failed.
   * The provider's own words go here, to the server log.
   */
  onFailure?: (failure: { chatId: string; code: string; message: string | undefined }) => void;
}

interface CachedSession {
  chatId: string;
  session: PiSession;
  providerId: string;
  modelId: string;
  /** What the session was opened with; a change means reopening. */
  instructions: string;
  /**
   * The terminal whose tools are registered in this session, if any. pi fixes
   * the tool list when the session opens, so a message from a DIFFERENT
   * machine -- or from the phone, naming none -- has to reopen it, exactly
   * like changed instructions below (docs/cli.md, Whose local access).
   */
  localConnectionId: string | undefined;
  /** Runs currently using it; a session in use is never swept. */
  busy: number;
  lastUsedAt: number;
}

export class PiAgentBridge implements AgentBridge, ProviderAuthBridge {
  private readonly sessions = new Map<string, CachedSession>();
  private sweeper: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: PiBridgeDeps) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const { chatId, model, onEvent, signal } = request;

    // Attachments become files in the workspace, and the prompt says where:
    // the agent reads them with the same tools it reads anything else. aw
    // extracts text server-side instead; an agent with a read tool need not.
    // Then the Skill Router prepends the few skills relevant to this message.
    const prompt = withRuntimeIdentity(
      request,
      await this.withSkills(this.withAttachments(request), request.prompt),
    );
    // Image attachments also go straight to the model when it is multimodal
    // (pop-agent.spec §14, RF-014); otherwise they stay files the agent reads with
    // its tools (RF-015 fallback).
    const images = imagesFor(request);

    // The pair is the identity (pop-agent.spec §15): the chat's override when it
    // works, the global default when it does not -- never an error.
    const pair = this.deps.resolvePair?.(request.provider ?? '', model) ?? {
      providerId:
        request.provider !== undefined && request.provider.length > 0
          ? request.provider
          : PROVIDER_ID,
      modelId: model.length > 0 ? model : DEFAULT_MODEL_ID,
    };

    let entry: CachedSession;
    try {
      entry = await this.acquire(
        chatId,
        pair.providerId,
        pair.modelId,
        request.localConnectionId,
      );
    } catch (error) {
      const code = errorCode(error);
      onEvent({ kind: 'error', code });
      this.deps.onFailure?.({ chatId, code, message: messageOf(error) });
      return {};
    }

    // Tool access belongs to the turn, not to the cached conversation. Pi
    // rebuilds its effective system prompt when this catalogue changes.
    entry.session.setExecutionMode(request.executionMode ?? 'normal');
    // Do not inherit pi's one-at-a-time default: Pop's durable FIFO may offer
    // several interventions during this assistant turn, and all must enter
    // before the next model call.
    entry.session.setSteeringMode('all');
    let translator = new RunTranslator(onEvent);
    const pendingSteering: { id: string; prompt: string; images?: PiImage[] }[] = [];
    const scheduledSteering = new Map<string, { cancelled: boolean }>();
    let steeringOperations = Promise.resolve();
    let controlActive = true;
    let unsubscribe = entry.session.subscribe((event) => {
      const delivered = takeDeliveredSteering(event, pendingSteering);
      if (delivered !== undefined) {
        scheduledSteering.delete(delivered);
        onEvent({ kind: 'steering-delivered', steeringId: delivered });
      }
      translator.handle(event);
    });

    request.onControlReady?.({
      steer: (input) => {
        if (!controlActive || signal.aborted) return Promise.resolve(false);
        if (scheduledSteering.has(input.id)) return Promise.resolve(true);
        const scheduled = { cancelled: false };
        scheduledSteering.set(input.id, scheduled);
        const operation = steeringOperations.then(async () => {
          if (
            scheduled.cancelled ||
            scheduledSteering.get(input.id) !== scheduled ||
            !controlActive ||
            signal.aborted
          ) {
            return false;
          }
          const steeringRequest: AgentRunRequest = {
            ...request,
            prompt: input.prompt,
            attachments: input.attachments,
          };
          const steeringPrompt = withRuntimeIdentity(
            steeringRequest,
            await this.withSkills(
              this.withAttachments(steeringRequest),
              steeringRequest.prompt,
            ),
          );
          if (
            scheduled.cancelled ||
            scheduledSteering.get(input.id) !== scheduled ||
            !controlActive ||
            signal.aborted
          ) {
            return false;
          }
          const images = entry.session.supportsImages ? imagesFor(steeringRequest) : undefined;
          pendingSteering.push({
            id: input.id,
            prompt: steeringPrompt,
            ...(images === undefined ? {} : { images }),
          });
          try {
            await entry.session.steer(steeringPrompt, images);
            return true;
          } catch {
            const index = pendingSteering.findIndex((item) => item.id === input.id);
            if (index >= 0) pendingSteering.splice(index, 1);
            if (scheduledSteering.get(input.id) === scheduled) scheduledSteering.delete(input.id);
            return false;
          }
        });
        steeringOperations = operation.then(() => undefined, () => undefined);
        return operation;
      },
      cancelSteering: (id) => {
        const scheduled = scheduledSteering.get(id);
        if (scheduled === undefined) return false;
        scheduled.cancelled = true;
        scheduledSteering.delete(id);
        steeringOperations = steeringOperations.then(async () => {
          const remaining = pendingSteering.filter((item) => item.id !== id);
          entry.session.clearQueue();
          pendingSteering.length = 0;
          for (const item of remaining) {
            if (!scheduledSteering.has(item.id)) continue;
            pendingSteering.push(item);
            try {
              await entry.session.steer(item.prompt, item.images);
            } catch {
              const failed = pendingSteering.findIndex((entry) => entry.id === item.id);
              if (failed >= 0) pendingSteering.splice(failed, 1);
              scheduledSteering.delete(item.id);
            }
          }
        });
        return true;
      },
      clearSteering: () => {
        for (const scheduled of scheduledSteering.values()) scheduled.cancelled = true;
        scheduledSteering.clear();
        steeringOperations = steeringOperations.then(() => {
          entry.session.clearQueue();
          pendingSteering.length = 0;
        });
      },
    });

    // The safety guard for this run: it feeds on tool output and, in a turn
    // that read something suspicious, refuses on its own the commands that
    // would exfiltrate, read a secret, or destroy irreversibly -- no dialog,
    // the model just gets told no (pop-agent.spec §10). A clean turn runs freely.
    entry.session.setGuard(
      new TaintGuard({
        ...(request.confirm === undefined ? {} : { confirm: request.confirm }),
        onTaint: (info) =>
          this.deps.onFailure?.({
            chatId,
            code: 'turn_tainted',
            message: `risk=${info.risk} ${info.warnings.join(',')}`,
          }),
      }),
    );

    // pi kills the process group of a running bash child on abort (it spawns
    // detached and SIGKILLs -pid), so stopping a run really does stop the work,
    // not just the stream.
    const onAbort = (): void => {
      void entry.session.abort();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    const preLeaf = entry.session.getLeafId();

    try {
      await entry.session.prompt(prompt, entry.session.supportsImages ? images : undefined);

      // The reactive compaction trigger (pop-agent.spec §7): token accounting
      // always errs a little, so when the provider refuses the turn for
      // context overflow, compact and retry the SAME turn -- exactly once,
      // never in a loop. The user sees one seamless run.
      if (!signal.aborted && translator.failedOnOverflow()) {
        this.deps.onFailure?.({
          chatId,
          code: 'context_overflow',
          message: 'provider refused the turn; compacting and retrying once',
        });
        // The overflowed turn stays on an abandoned branch; the retry replaces
        // it on the main path instead of following it in the JSONL.
        entry.session.rewindToLeaf(preLeaf);
        unsubscribe();
        try {
          await entry.session.compact();
        } catch {
          // A failed compaction still deserves the retry: pi's threshold may
          // simply not have fired yet, and the second attempt costs one turn.
        }
        const firstAttempt = translator;
        translator = new RunTranslator(onEvent);
        translator.carryUsageFrom(firstAttempt);
        unsubscribe = entry.session.subscribe((event) => {
          const delivered = takeDeliveredSteering(event, pendingSteering);
          if (delivered !== undefined) {
            scheduledSteering.delete(delivered);
            onEvent({ kind: 'steering-delivered', steeringId: delivered });
          }
          translator.handle(event);
        });
        await entry.session.prompt(prompt, entry.session.supportsImages ? images : undefined);
      }

      translator.finish(signal.aborted);
    } catch (error) {
      translator.fail(
        signal.aborted ? 'aborted' : errorCode(error),
        messageOf(error),
        statusOf(error),
      );
    } finally {
      controlActive = false;
      if (pendingSteering.length > 0) {
        entry.session.clearQueue();
        pendingSteering.length = 0;
        scheduledSteering.clear();
      }
      entry.session.setGuard(undefined);
      unsubscribe();
      signal.removeEventListener('abort', onAbort);

      const failure = translator.failure;
      // A failover-class refusal leaves the doomed turn on a side branch so
      // the next provider (or the next bridge.run for failover) prompts from
      // a clean main path -- one user message, not two.
      if (
        failure !== undefined &&
        shouldFailOver({ code: failure.code, ...(failure.status === undefined ? {} : { status: failure.status }) })
      ) {
        entry.session.rewindToLeaf(preLeaf);
      }

      this.release(entry);

      const usage = translator.usage;
      if (usage !== undefined && this.deps.onUsage !== undefined) {
        this.deps.onUsage({ chatId, provider: entry.providerId, model: entry.modelId, ...usage });
      }
      if (failure !== undefined && this.deps.onFailure !== undefined) {
        this.deps.onFailure({ chatId, ...failure });
      }
    }

    const usage = translator.usage;
    return usage === undefined
      ? {}
      : { usage: { provider: entry.providerId, model: entry.modelId, ...usage } };
  }

  listModels(providerId?: string): Promise<ModelInfo[]> {
    return this.deps.engine.models(providerId ?? '');
  }

  complete(request: EngineCompletionRequest): Promise<{ text: string; usage?: RunUsage }> {
    return this.deps.engine.complete(request);
  }

  // Subscription auth (pop-agent.spec §15, fase 1.5): the bridge only forwards --
  // credentials live in the engine's store and never surface here.
  hasProviderAuth(providerId: string): boolean {
    return this.deps.engine.hasProviderAuth(providerId);
  }

  providerLogin(providerId: string, interaction: ProviderAuthInteraction): Promise<void> {
    return this.deps.engine.providerLogin(providerId, interaction);
  }

  providerLogout(providerId: string): Promise<void> {
    return this.deps.engine.providerLogout(providerId);
  }

  providerSubscriptionUsage(
    providerId: string,
  ): Promise<ProviderSubscriptionUsage | undefined> {
    return this.deps.engine.providerSubscriptionUsage(providerId);
  }

  /**
   * Drops a chat's cached session, disposing it. Called before a chat is
   * deleted so nothing rewrites its JSONL after the file is removed.
   */
  forget(chatId: string): void {
    this.discardSession(chatId);
  }

  /**
   * Hard-forgets a session even while a run still holds it: the zombie's JSONL
   * writes land on an abandoned branch (see rewindToLeaf), and the next
   * acquire opens fresh from the clean main path.
   */
  discardSession(chatId: string): void {
    const entry = this.sessions.get(chatId);
    if (entry === undefined) return;
    entry.session.dispose();
    this.sessions.delete(chatId);
  }

  /** Disposes every live session. For shutdown and for tests. */
  close(): void {
    if (this.sweeper !== undefined) clearInterval(this.sweeper);
    this.sweeper = undefined;
    for (const entry of this.sessions.values()) entry.session.dispose();
    this.sessions.clear();
  }

  /**
   * "Restart LLM" (LOTE 6): drops every live session so the next run builds
   * a fresh runtime, without killing the sweeper like {@link close} does --
   * the process lives on.
   */
  resetSessions(): void {
    for (const entry of this.sessions.values()) entry.session.dispose();
    this.sessions.clear();
  }

  /**
   * Prepends the skills the router picked for this message (pop-agent.spec §8).
   * These are Pop Agent's own trusted instructions, so they lead the prompt rather
   * than being wrapped as untrusted data.
   */
  private async withSkills(prompt: string, message: string): Promise<string> {
    const blocks = (await this.deps.skillsFor?.(message)) ?? [];
    if (blocks.length === 0) return prompt;
    return (
      `[Relevant skills for this request — follow them:\n\n${blocks.join('\n\n---\n\n')}\n]\n\n` +
      prompt
    );
  }

  /** Writes the attached files and appends their whereabouts to the prompt. */
  private withAttachments(request: AgentRunRequest): string {
    const { workspace } = this.deps;
    if (workspace === undefined || request.attachments.length === 0) return request.prompt;

    const saved: string[] = [];
    for (const attachment of request.attachments) {
      const relative = saveAttachment(workspace, request.chatId, attachment);
      if (relative !== undefined) saved.push(`- ${relative} (${attachment.type})`);
    }
    if (saved.length === 0) return request.prompt;

    return (
      `${request.prompt}\n\n` +
      `[The user attached ${String(saved.length)} file(s), saved in your workspace:\n` +
      `${saved.join('\n')}\n` +
      `Open them with your tools when they matter to the request.]`
    );
  }

  private async acquire(
    chatId: string,
    providerId: string,
    modelId: string,
    localConnectionId: string | undefined,
  ): Promise<CachedSession> {
    const instructions = this.deps.instructions?.() ?? '';

    let cached = this.sessions.get(chatId);
    // Instructions live in the system prompt, and the local tools live in the
    // tool list; pi fixes both when the session opens. Reopening from the
    // JSONL is the same move that survives a restart, so either change costs
    // one transparent reload, not the conversation. Local access belongs to this
    // MESSAGE, so answering from the laptop and then from the phone reopens
    // once each way -- which is the price of the tools meaning one machine.
    const stale =
      cached !== undefined &&
      (cached.instructions !== instructions || cached.localConnectionId !== localConnectionId);
    if (cached !== undefined && stale && cached.busy === 0) {
      cached.session.dispose();
      this.sessions.delete(chatId);
      cached = undefined;
    }

    if (cached !== undefined && cached.providerId !== providerId && cached.busy === 0) {
      // A provider switch must pass through engine.open again. setModel only
      // changes pi's model object; it does not apply the new provider's key or
      // lazily register a custom provider. Reopening the same JSONL keeps the
      // conversation while authenticatedRuntime prepares the replacement.
      cached.session.dispose();
      this.sessions.delete(chatId);
      cached = undefined;
    }

    if (cached !== undefined) {
      // A model switch inside one provider needs no new authentication. The
      // JSONL history remains untouched (pop-agent.spec §15).
      if (cached.modelId !== modelId) {
        await cached.session.setModel(providerId, modelId);
        cached.modelId = modelId;
      }
      cached.busy += 1;
      cached.lastUsedAt = Date.now();
      return cached;
    }

    const chat = this.deps.chats.get(chatId);
    const session = await this.deps.engine.open({
      providerId,
      modelId,
      sessionFile: chat?.piSessionId,
      instructions,
      chatId,
      ...(localConnectionId === undefined ? {} : { localConnectionId }),
    });

    const entry: CachedSession = {
      chatId,
      session,
      providerId,
      modelId,
      instructions,
      localConnectionId,
      busy: 1,
      lastUsedAt: Date.now(),
    };
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

/** Matches pi's user-message event to the durable steering item that produced it. */
function takeDeliveredSteering(
  event: AgentSessionEvent,
  pending: { id: string; prompt: string }[],
): string | undefined {
  if (event.type !== 'message_start' || event.message.role !== 'user') return undefined;
  const content = event.message.content;
  const text = typeof content === 'string'
    ? content
    : content
        .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
        .map((part) => part.text)
        .join('');
  const index = pending.findIndex((item) => item.prompt === text);
  if (index < 0) return undefined;
  return pending.splice(index, 1)[0]?.id;
}

/**
 * What the bridge consumes, once pi's event stream has been read for the parts
 * Pop Agent renders. Anything else pi emits -- turn boundaries, compaction, retries,
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
 * pi's events, mapped to the handful Pop Agent renders (docs/agent-flow.md §1).
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
  private reported: { code: string; message: string | undefined; status?: number } | undefined;
  private lastStopReason = '';
  private lastErrorMessage: string | undefined;

  constructor(
    private readonly onEvent: (event: AgentEvent) => void,
    seed?: TurnUsage,
  ) {
    if (seed !== undefined) this.total = { ...seed };
  }

  /** The billed usage from a prior attempt in the same run (overflow retry). */
  carryUsageFrom(other: RunTranslator): void {
    const usage = other.usage;
    if (usage === undefined) return;
    this.count(usage);
  }

  get usage(): TurnUsage | undefined {
    return this.total;
  }

  get failure(): { code: string; message: string | undefined; status?: number } | undefined {
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

  /**
   * The run settled on a provider error that names the context window
   * (pop-agent.spec §7, reactive trigger). pi retries transient failures by
   * itself; an overflow it only surfaces.
   */
  failedOnOverflow(): boolean {
    return this.lastStopReason === 'error' && isContextOverflow(this.lastErrorMessage);
  }

  /** The run is over: say whether it worked. */
  finish(aborted: boolean): void {
    if (aborted || this.lastStopReason === 'aborted') this.fail('aborted', undefined);
    else if (this.lastStopReason === 'error') {
      // Typed for failover (pop-agent.spec §15, fase 2): a transport failure gets
      // its own code, and an HTTP refusal carries its status when the
      // provider's message names one.
      const message = this.lastErrorMessage;
      if (isNetworkFailure(message)) this.fail('network_error', message);
      else this.fail('provider_error', message, extractHttpStatus(message));
    }
  }

  /** Reports a failed run once; later ones are the same failure echoing. */
  fail(code: string, message: string | undefined, status?: number): void {
    if (this.reported !== undefined) return;
    this.reported = { code, message, ...(status === undefined ? {} : { status }) };
    this.onEvent({ kind: 'error', code, ...(status === undefined ? {} : { status }) });
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

/**
 * States which provider and model are answering, on the turn itself.
 *
 * The pair can change between two turns of the same conversation -- a chat
 * override, a new global default, a failover -- so a fact recorded anywhere
 * more durable than the turn goes stale and the agent then describes itself
 * wrongly, confidently. Cheap to restate, so it is restated every time.
 */
function withRuntimeIdentity(request: AgentRunRequest, prompt: string): string {
  const model = request.model.length > 0 ? request.model : 'the configured default';
  const provider = request.provider !== undefined && request.provider.length > 0
    ? request.provider
    : 'the configured default';
  const plan = request.executionMode === 'plan'
    ? '\n\n[PLAN MODE ACTIVE: This turn is strictly read-only. Investigate, analyze, and produce a plan. Do not create, edit, delete, execute changes, or claim that proposed changes were implemented. Only the read-only tools exposed for this turn may be used.]'
    : '';
  return `[This turn runs on provider "${provider}", model "${model}". This is the truth about what is answering right now; prefer it over anything a skill or an older message says.]${plan}\n\n${prompt}`;
}

/**
 * The image attachments as multimodal content: base64 without the data-URI
 * prefix, plus the mime type (pop-agent.spec §14, RF-014). Non-images, and payloads
 * that are not well-formed data URIs, are skipped -- they still land on disk
 * via saveAttachment for the agent's tools.
 */
function imagesFor(request: AgentRunRequest): PiImage[] {
  const images: PiImage[] = [];
  for (const attachment of request.attachments) {
    if (!attachment.type.startsWith('image/')) continue;
    const match = /^data:[^;,]*;base64,(.+)$/.exec(attachment.dataUri);
    if (match?.[1] === undefined) continue;
    images.push({ data: match[1], mimeType: attachment.type });
  }
  return images;
}

/**
 * One attachment onto disk, under `attachments/<chatId>/` in the workspace.
 * Returns the workspace-relative path, or undefined for a payload that is not
 * a well-formed data URI -- a bad file must not sink the whole run.
 */
function saveAttachment(
  workspace: string,
  chatId: string,
  attachment: Attachment,
): string | undefined {
  const match = /^data:[^;,]*;base64,(.+)$/.exec(attachment.dataUri);
  if (match?.[1] === undefined) return undefined;

  // The name is the user's; the path it lands on is ours.
  const name = basename(attachment.name).replace(/[^\w.() -]/g, '_') || 'file';
  const dir = join(workspace, 'attachments', chatId);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), Buffer.from(match[1], 'base64'));
  } catch {
    return undefined;
  }
  return `attachments/${chatId}/${name}`;
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
/** How a provider says "this did not fit": the wording varies, the meaning does not. */
const OVERFLOW_PATTERN =
  /context.{0,24}(length|window|overflow|too long|exceed)|maximum context|prompt is too long|too many tokens|token limit|reduce the length/i;

function isContextOverflow(message: string | undefined): boolean {
  return message !== undefined && OVERFLOW_PATTERN.test(message);
}

function errorCode(error: unknown): string {
  if (error instanceof PiEngineError) return error.code;
  if (isNetworkFailure(messageOf(error)) || networkCodeOf(error) !== undefined) {
    return 'network_error';
  }
  return 'operation_error';
}

function messageOf(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/**
 * The HTTP status a thrown error carries, when the SDK put one on it
 * (`status`/`statusCode` on the error or its cause). Typed input for the
 * failover classifier (pop-agent.spec §15, fase 2).
 */
function statusOf(error: unknown): number | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const record = candidate as Record<string, unknown>;
    for (const key of ['status', 'statusCode']) {
      const value = record[key];
      if (typeof value === 'number' && value >= 400 && value <= 599) return value;
    }
  }
  return undefined;
}

/** The `code` of a Node system error (`ECONNREFUSED`…), wherever it hides. */
function networkCodeOf(error: unknown): string | undefined {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const code = (candidate as Record<string, unknown>)['code'];
    if (typeof code === 'string' && NETWORK_CODES.has(code)) return code;
  }
  return undefined;
}

const NETWORK_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * A provider error that is really the wire failing: the Node error codes
 * above, TLS trouble, an interrupted stream. Matched against the code-like
 * tokens providers embed in their messages, not against free prose.
 */
const NETWORK_FAILURE_PATTERN =
  /\b(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH|UND_ERR_\w+)\b|fetch failed|socket hang up|TLS handshake|certificate|unexpected (end of file|EOF)/i;

export function isNetworkFailure(message: string | undefined): boolean {
  return message !== undefined && NETWORK_FAILURE_PATTERN.test(message);
}

/**
 * The status of an HTTP refusal, read from the code-shaped places providers
 * put it: the front of the message ("402 …"), an explicit "status code 402",
 * or the status word next to the number ("402 Payment Required"). Never a
 * bare number from the middle of prose -- a model name or a token count must
 * not become a status.
 */
const STATUS_PATTERNS = [
  /^\s*\(?([45]\d{2})\)?[\s:-]/,
  /\bstatus(?:\s+code)?[:\s]+\(?([45]\d{2})\b/i,
  /\b([45]\d{2})\s+(?:Bad Request|Unauthorized|Payment Required|Forbidden|Not Found|Method Not Allowed|Request Timeout|Conflict|Payload Too Large|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|Overloaded)\b/i,
];

export function extractHttpStatus(message: string | undefined): number | undefined {
  if (message === undefined) return undefined;
  for (const pattern of STATUS_PATTERNS) {
    const match = pattern.exec(message);
    if (match?.[1] !== undefined) return Number(match[1]);
  }
  return undefined;
}
