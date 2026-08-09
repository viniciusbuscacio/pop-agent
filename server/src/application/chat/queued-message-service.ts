import type { Attachment, MessageClient } from '../../domain/chat/chat.js';
import { entityId } from '../../domain/ids.js';
import type { ChatRepo } from '../ports/chat-repo.js';
import type { Clock } from '../ports/clock.js';
import type { EventSink } from '../ports/event-sink.js';
import type {
  QueuedMessage,
  QueuedMessageDelivery,
  QueuedMessageRepo,
} from '../ports/queued-message-repo.js';
import type { RunService } from './run-service.js';

export interface QueueInput {
  text: string;
  /** Default steering; /queue explicitly chooses the old follow-up behavior. */
  deliveryMode?: QueuedMessageDelivery;
  attachments: Attachment[];
  filePaths: string[];
  client?: MessageClient;
  handsConnectionId?: string;
}

export const MAX_PENDING_MESSAGES_PER_CHAT = 1024;

export type QueueWriteResult =
  | { ok: true; message: QueuedMessage; head: QueuedMessage }
  | { ok: false; reason: 'chat_not_found' | 'queue_full' | 'queue_not_found' };

/**
 * Owns each chat's durable pending-input FIFO. HTTP may append and may
 * edit/cancel its head, while steering delivery or run completion advances it.
 * A high defensive cap prevents broken clients from growing it forever.
 */
export class QueuedMessageService {
  constructor(
    private readonly deps: {
      repo: QueuedMessageRepo;
      chats: ChatRepo;
      runs: RunService;
      clock: Clock;
      sink: EventSink;
      resolveFile(path: string): Attachment | undefined;
    },
  ) {}

  get(chatId: string): QueuedMessage | undefined {
    return this.deps.repo.get(chatId);
  }

  enqueue(chatId: string, input: QueueInput): QueueWriteResult {
    if (this.deps.chats.get(chatId) === undefined) return { ok: false, reason: 'chat_not_found' };
    if (this.deps.repo.count(chatId) >= MAX_PENDING_MESSAGES_PER_CHAT) {
      return { ok: false, reason: 'queue_full' };
    }
    const now = new Date(this.deps.clock.now()).toISOString();
    const message: QueuedMessage = {
      id: entityId('queued'),
      chatId,
      ...input,
      deliveryMode: input.deliveryMode ?? 'steer',
      createdAt: now,
      updatedAt: now,
    };
    // Services are synchronous around this repository, so count + create cannot
    // interleave inside this process. The id conflict fallback is still reported
    // as full rather than silently losing an accepted input.
    if (!this.deps.repo.create(message)) return { ok: false, reason: 'queue_full' };
    const head = this.deps.repo.get(chatId) ?? message;
    this.announce(head);
    this.offerSteering(chatId);
    return { ok: true, message, head };
  }

  update(chatId: string, input: QueueInput): QueueWriteResult {
    if (this.deps.chats.get(chatId) === undefined) return { ok: false, reason: 'chat_not_found' };
    const current = this.deps.repo.get(chatId);
    if (current === undefined) return { ok: false, reason: 'queue_not_found' };
    const message: QueuedMessage = {
      ...current,
      ...input,
      // Editing changes the payload, never the delivery contract originally chosen.
      deliveryMode: current.deliveryMode,
      updatedAt: new Date(this.deps.clock.now()).toISOString(),
    };
    this.deps.runs.cancelSteering(chatId, current.id);
    if (!this.deps.repo.update(message)) return { ok: false, reason: 'queue_not_found' };
    this.announce(message);
    if (message.deliveryMode === 'steer') this.offerSteering(chatId);
    return { ok: true, message, head: message };
  }

  cancel(chatId: string): QueueWriteResult {
    if (this.deps.chats.get(chatId) === undefined) return { ok: false, reason: 'chat_not_found' };
    const current = this.deps.repo.get(chatId);
    if (current === undefined) return { ok: false, reason: 'queue_not_found' };
    this.deps.runs.cancelSteering(chatId, current.id);
    if (!this.deps.repo.delete(current.id)) {
      return { ok: false, reason: 'queue_not_found' };
    }
    const head = this.deps.repo.get(chatId);
    this.announce(head, chatId);
    this.offerSteering(chatId);
    return { ok: true, message: current, head: head ?? current };
  }

  /** Offers the FIFO head to pi without deleting it until pi consumes it. */
  offerSteering(chatId: string): boolean {
    const queued = this.deps.repo.get(chatId);
    if (
      queued === undefined ||
      queued.deliveryMode !== 'steer' ||
      !this.deps.runs.canSteer(chatId, queued.handsConnectionId)
    ) {
      return false;
    }
    const referenced = this.resolveReferences(queued);
    if (referenced === undefined) return false;
    return this.deps.runs.offerSteering(chatId, {
      id: queued.id,
      text: queued.text,
      attachments: [...queued.attachments, ...referenced],
      ...(queued.client === undefined ? {} : { client: queued.client }),
      ...(queued.handsConnectionId === undefined
        ? {}
        : { handsConnectionId: queued.handsConnectionId }),
    });
  }

  /** Advances the FIFO only after pi emits the corresponding user-message start. */
  delivered(chatId: string, steeringId: string): boolean {
    const queued = this.deps.repo.get(chatId);
    if (queued === undefined || queued.id !== steeringId || !this.deps.repo.delete(steeringId)) {
      return false;
    }
    this.announce(this.deps.repo.get(chatId), chatId);
    // Pi's default one-at-a-time mode has just consumed the former head. Offer
    // the next item now so it can steer the following assistant turn.
    this.offerSteering(chatId);
    return true;
  }

  /** Starts the waiting turn once, after its current run has left the registry. */
  drain(chatId: string): boolean {
    const queued = this.deps.repo.get(chatId);
    if (
      queued === undefined ||
      this.deps.runs.liveRun(chatId) !== undefined ||
      !this.deps.runs.isAcceptingRuns()
    ) {
      return false;
    }

    const referenced = this.resolveReferences(queued);
    // Keep the row editable/cancellable instead of losing it when a referenced
    // file was moved while it waited.
    if (referenced === undefined) return false;

    const started = this.deps.runs.startRun(
      chatId,
      queued.text,
      [...queued.attachments, ...referenced],
      {
        ...(queued.client === undefined ? {} : { client: queued.client }),
        ...(queued.handsConnectionId === undefined
          ? {}
          : { handsConnectionId: queued.handsConnectionId }),
      },
    );
    if (!started.ok) {
      if (started.reason === 'chat_not_found') {
        this.deps.repo.delete(queued.id);
        this.announce(this.deps.repo.get(chatId), chatId);
      }
      return false;
    }

    // startRun persists the user message before returning. Only now is the
    // queue row consumed; duplicate drain callbacks cannot send it again.
    this.deps.repo.delete(queued.id);
    this.announce(this.deps.repo.get(chatId), chatId, {
      runId: started.runId,
      userMessageId: started.userMessageId,
      text: queued.text,
      attachments: [...queued.attachments, ...referenced],
      createdAt: new Date(this.deps.clock.now()).toISOString(),
    });
    return true;
  }

  private resolveReferences(queued: QueuedMessage): Attachment[] | undefined {
    const referenced: Attachment[] = [];
    for (const path of queued.filePaths) {
      const attachment = this.deps.resolveFile(path);
      if (attachment === undefined) return undefined;
      referenced.push(attachment);
    }
    return referenced;
  }

  /** Recovery after a process restart, and after the operator starts the LLM. */
  drainAll(): void {
    for (const message of this.deps.repo.list()) this.drain(message.chatId);
  }

  private announce(
    message: QueuedMessage | undefined,
    chatId = message?.chatId,
    started?: {
      runId: string;
      userMessageId: string;
      text: string;
      attachments: Attachment[];
      createdAt: string;
    },
  ): void {
    if (chatId === undefined) return;
    this.deps.sink.emit({
      kind: 'queue',
      chatId,
      ...(message === undefined ? {} : { message }),
      ...(started === undefined ? {} : { started }),
    });
  }
}
