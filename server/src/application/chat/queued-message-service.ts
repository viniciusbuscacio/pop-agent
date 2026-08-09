import type { Attachment, MessageClient } from '../../domain/chat/chat.js';
import { entityId } from '../../domain/ids.js';
import type { ChatRepo } from '../ports/chat-repo.js';
import type { Clock } from '../ports/clock.js';
import type { EventSink } from '../ports/event-sink.js';
import type { QueuedMessage, QueuedMessageRepo } from '../ports/queued-message-repo.js';
import type { RunService } from './run-service.js';

export interface QueueInput {
  text: string;
  attachments: Attachment[];
  filePaths: string[];
  client?: MessageClient;
  handsConnectionId?: string;
}

export type QueueWriteResult =
  | { ok: true; message: QueuedMessage }
  | { ok: false; reason: 'chat_not_found' | 'queue_exists' | 'queue_not_found' };

/**
 * Owns the durable follow-up slot. HTTP may create/edit/cancel it, while run
 * completion drains it synchronously into RunService. SQLite's unique chat id
 * is the final arbiter when two tabs race to fill the same slot.
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
    const now = new Date(this.deps.clock.now()).toISOString();
    const message: QueuedMessage = {
      id: entityId('queued'),
      chatId,
      ...input,
      createdAt: now,
      updatedAt: now,
    };
    if (!this.deps.repo.create(message)) return { ok: false, reason: 'queue_exists' };
    this.announce(message);
    return { ok: true, message };
  }

  update(chatId: string, input: QueueInput): QueueWriteResult {
    if (this.deps.chats.get(chatId) === undefined) return { ok: false, reason: 'chat_not_found' };
    const current = this.deps.repo.get(chatId);
    if (current === undefined) return { ok: false, reason: 'queue_not_found' };
    const message: QueuedMessage = {
      ...current,
      ...input,
      updatedAt: new Date(this.deps.clock.now()).toISOString(),
    };
    if (!this.deps.repo.update(message)) return { ok: false, reason: 'queue_not_found' };
    this.announce(message);
    return { ok: true, message };
  }

  cancel(chatId: string): QueueWriteResult {
    if (this.deps.chats.get(chatId) === undefined) return { ok: false, reason: 'chat_not_found' };
    const current = this.deps.repo.get(chatId);
    if (current === undefined || !this.deps.repo.delete(chatId)) {
      return { ok: false, reason: 'queue_not_found' };
    }
    this.announce(undefined, chatId);
    return { ok: true, message: current };
  }

  /** Starts the waiting turn once, after its current run has left the registry. */
  drain(chatId: string): boolean {
    const queued = this.deps.repo.get(chatId);
    if (
      queued === undefined ||
      this.deps.runs.liveRun(chatId) !== undefined ||
      this.deps.runs.isLlmStopped()
    ) {
      return false;
    }

    const referenced: Attachment[] = [];
    for (const path of queued.filePaths) {
      const attachment = this.deps.resolveFile(path);
      // Keep the row editable/cancellable instead of losing it when a referenced
      // file was moved while it waited.
      if (attachment === undefined) return false;
      referenced.push(attachment);
    }

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
        this.deps.repo.delete(chatId);
        this.announce(undefined, chatId);
      }
      return false;
    }

    // startRun persists the user message before returning. Only now is the
    // queue row consumed; duplicate drain callbacks cannot send it again.
    this.deps.repo.delete(chatId);
    this.announce(undefined, chatId, {
      runId: started.runId,
      userMessageId: started.userMessageId,
      text: queued.text,
      attachments: [...queued.attachments, ...referenced],
      createdAt: new Date(this.deps.clock.now()).toISOString(),
    });
    return true;
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
