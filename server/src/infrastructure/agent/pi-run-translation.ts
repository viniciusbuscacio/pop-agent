import { currentTimeNote } from '../../application/chat/channel-note.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Attachment } from '../../domain/chat/chat.js';
import type { AgentEvent, AgentRunRequest } from '../../application/ports/agent-bridge.js';
import { PiEngineError, type PiImage } from './pi-engine.js';

/** Matches pi's user-message event to the durable steering item that produced it. */
export function takeDeliveredSteering(
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
 * The SDK emits text and
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
export class RunTranslator {
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
   * (docs/specs/Spec-Pop-General.md §7, reactive trigger). pi retries transient failures by
   * itself; an overflow it only surfaces.
   */
  failedOnOverflow(): boolean {
    return this.lastStopReason === 'error' && isContextOverflow(this.lastErrorMessage);
  }

  /** The run is over: say whether it worked. */
  finish(aborted: boolean): void {
    if (aborted || this.lastStopReason === 'aborted') this.fail('aborted', undefined);
    else if (this.lastStopReason === 'error') {
      // Typed for failover: a transport failure gets
      // its own code, and an HTTP refusal carries its status when the
      // provider's message names one.
      const message = this.lastErrorMessage;
      if (isCodexRateLimit(message)) this.fail('provider_rate_limit', message);
      else if (isNetworkFailure(message)) this.fail('network_error', message);
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
export function withRuntimeIdentity(request: AgentRunRequest, prompt: string, now = Date.now()): string {
  const model = request.model.length > 0 ? request.model : 'the configured default';
  const provider = request.provider !== undefined && request.provider.length > 0
    ? request.provider
    : 'the configured default';
  const plan = request.executionMode === 'plan'
    ? '\n\n[PLAN MODE ACTIVE: This turn is strictly read-only. Investigate, analyze, and produce a plan. Do not create, edit, delete, execute changes, or claim that proposed changes were implemented. Only the read-only tools exposed for this turn may be used.]'
    : '';
  return `[This turn runs on provider "${provider}", model "${model}". This is the truth about what is answering right now; prefer it over anything a skill or an older message says.]${plan}\n\n${currentTimeNote(request.prompt, now)}\n\n${prompt}`;
}

/**
 * The image attachments as multimodal content: base64 without the data-URI
 * prefix, plus the mime type (docs/specs/Spec-Pop-General.md §14, RF-014). Non-images, and payloads
 * that are not well-formed data URIs, are skipped -- they still land on disk
 * via saveAttachment for the agent's tools.
 */
export function imagesFor(request: AgentRunRequest): PiImage[] {
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
export function saveAttachment(
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

export function errorCode(error: unknown): string {
  if (error instanceof PiEngineError) return error.code;
  if (isCodexRateLimit(messageOf(error))) return 'provider_rate_limit';
  if (isNetworkFailure(messageOf(error)) || networkCodeOf(error) !== undefined) {
    return 'network_error';
  }
  return 'operation_error';
}

/** Machine codes preserved by the pinned SDK patch, never a prose quota guess. */
function isCodexRateLimit(message: string | undefined): boolean {
  return message !== undefined && /^Codex error \((usage_limit_reached|usage_not_included|rate_limit_exceeded)\): /.test(message);
}

export function messageOf(error: unknown): string | undefined {
  return error instanceof Error ? error.message : undefined;
}

/**
 * The HTTP status a thrown error carries, when the SDK put one on it
 * (`status`/`statusCode` on the error or its cause). Typed input for the
 * failover classifier in the providers/models specification.
 */
export function statusOf(error: unknown): number | undefined {
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
