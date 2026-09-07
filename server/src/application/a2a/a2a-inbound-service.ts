import type { Clock } from '../ports/clock.js';
import { createHash, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { InboundA2aRecord, InboundA2aRepo } from '../ports/a2a-inbound-repo.js';
import type { RunEvent } from '../ports/event-sink.js';
import type { ChatService } from '../chat/chat-service.js';
import type { RunService } from '../chat/run-service.js';
import type { IntegrationService } from '../integrations/integration-service.js';

export class A2aInboundError extends Error {
  constructor(readonly code: 'not_found' | 'invalid_input' | 'not_cancelable' | 'unavailable', message: string) { super(message); }
}
export interface InboundTask {
  id: string; contextId: string; state: 'working' | 'completed' | 'failed' | 'canceled';
  text: string; timestamp: string;
}
export class A2aInboundService {
  constructor(private readonly deps: { repo: InboundA2aRepo; clock: Clock; chats: ChatService; runs: RunService; integrations: IntegrationService }) {}
  private record(id: string): InboundA2aRecord {
    const value = this.deps.repo.get(id);
    if (!value) throw new A2aInboundError('not_found', 'No such A2A task.');
    return value;
  }
  send(input: { messageId: string; contextId: string; taskId: string; text: string; author?: 'owner' | 'agent' | 'unknown' }): InboundTask {
    if (!input.messageId || input.messageId.length > 200 || !input.text.trim() || [...input.text].length > 32000 ||
        input.contextId.length > 200 || input.taskId)
      throw new A2aInboundError('invalid_input', 'Provide a new text message and an optional known context.');
    this.deps.repo.prune(new Date(this.deps.clock.now() - 30 * 86400000).toISOString());
    const digest = createHash('sha256').update(JSON.stringify([input.contextId, input.text, input.author ?? 'unknown'])).digest('hex');
    const repeated = this.deps.repo.byMessage(input.messageId);
    if (repeated) {
      if (repeated.digest !== digest) throw new A2aInboundError('invalid_input', 'Message ID was already used for different content.');
      return this.get(repeated.id);
    }
    if (this.deps.repo.count() >= 1000) throw new A2aInboundError('unavailable', 'A2A task storage limit reached.');
    const context = input.contextId ? this.deps.repo.byContext(input.contextId) : undefined;
    if (input.contextId && !context) throw new A2aInboundError('not_found', 'No such A2A context.');
    if (context && this.deps.runs.liveRun(context.chatId)) throw new A2aInboundError('unavailable', 'This A2A context is busy.');
    const chat = context ? undefined : this.deps.chats.create();
    const chatId = context?.chatId ?? chat!.id;
    if (chat) this.deps.chats.rename(chat.id, 'A2A · ' + chat.title);
    const record: InboundA2aRecord = { id: randomUUID(), contextId: context?.contextId ?? randomUUID(),
      chatId, runId: '', state: 'working', text: '', timestamp: new Date(this.deps.clock.now()).toISOString(), messageId: input.messageId, digest, createdAt: new Date(this.deps.clock.now()).toISOString() };
    // Record ownership and deduplication before admitting any work. A crash
    // during admission is reported as failed rather than silently replayed.
    this.deps.repo.save(record);
    const result = this.deps.runs.startRun(chatId, input.text, [], { client: { kind: input.author === 'owner' ? 'a2a-owner' : input.author === 'agent' ? 'a2a-agent' : 'a2a-unknown' }, notify: false });
    if (result.ok) record.runId = result.runId;
    this.deps.repo.save(record);
    return this.get(record.id);
  }
  get(id: string): InboundTask {
    const record = this.record(id);
    if (record.state !== 'working') return { id, contextId: record.contextId, state: record.state, text: record.text, timestamp: record.timestamp };
    const activity = record.runId ? this.deps.integrations.repo.activity(record.runId) : undefined;
    const live = this.deps.runs.liveRun(record.chatId);
    const state = activity?.state === 'completed' ? 'completed' : activity?.state === 'cancelled' ? 'canceled'
      : activity?.state === 'failed' ? 'failed' : live?.runId === record.runId && record.runId ? 'working' : 'failed';
    const message = state === 'completed' && activity?.messageId
      ? this.deps.chats.getMessages(record.chatId, { limit: 100 })?.find(item => item.id === activity.messageId) : undefined;
    const result: InboundTask = { id, contextId: record.contextId, state, text: message?.content.slice(0, 64000) ?? '',
      timestamp: activity ? new Date(activity.updatedAt).toISOString() : record.createdAt };
    if (state !== 'working') this.deps.repo.save({ ...record, ...result });
    return result;
  }
  observe(event: RunEvent): void {
    if ((event.kind === 'done' || event.kind === 'error') && 'runId' in event && event.runId) {
      const record = this.deps.repo.byRun(event.runId);
      if (record) this.get(record.id);
    }
  }
  cancel(id: string): InboundTask {
    const record = this.record(id);
    if (this.get(id).state !== 'working') throw new A2aInboundError('not_cancelable', 'This task is already finished.');
    if (this.deps.runs.liveRun(record.chatId)?.runId === record.runId) this.deps.runs.stopRun(record.chatId);
    return this.get(id);
  }
  async wait(id: string, signal: AbortSignal, authorize: () => void): Promise<InboundTask> {
    const deadline = AbortSignal.timeout(60_000);
    const combined = AbortSignal.any([signal, deadline]);
    while (true) {
      authorize();
      const task = this.get(id);
      if (task.state !== 'working') return task;
      // Foreground request only; no background polling or retained waiters.
      await delay(200, undefined, { signal: combined });
    }
  }
}
