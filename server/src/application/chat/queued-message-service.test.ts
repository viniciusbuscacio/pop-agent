import { describe, expect, it } from 'vitest';
import type { QueuedMessage, QueuedMessageRepo } from '../ports/queued-message-repo.js';
import { QueuedMessageService } from './queued-message-service.js';
import type { RunService, SteeringInput } from './run-service.js';

const CHAT = 'chat-A1b2C3d4E5f';

class MemoryQueue implements QueuedMessageRepo {
  readonly items: QueuedMessage[] = [];
  get(chatId: string) { return this.list(chatId)[0]; }
  getById(chatId: string, id: string) {
    return this.items.find((item) => item.chatId === chatId && item.id === id);
  }
  count(chatId: string) { return this.list(chatId).length; }
  list(chatId?: string) {
    return this.items.filter((item) => chatId === undefined || item.chatId === chatId);
  }
  create(message: QueuedMessage) { this.items.push(message); return true; }
  update(message: QueuedMessage) {
    const index = this.items.findIndex((item) => item.id === message.id);
    if (index < 0) return false;
    this.items[index] = message;
    return true;
  }
  delete(id: string) {
    const index = this.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.items.splice(index, 1);
    return true;
  }
}

function pending(id: string, deliveryMode: QueuedMessage['deliveryMode'] = 'steer'): QueuedMessage {
  return {
    id,
    chatId: CHAT,
    text: id,
    deliveryMode,
    attachments: [],
    filePaths: [],
    createdAt: id,
    updatedAt: id,
  };
}

function harness(items: QueuedMessage[]) {
  const repo = new MemoryQueue();
  repo.items.push(...items);
  const offered: SteeringInput[] = [];
  let clears = 0;
  const runs = {
    canSteer: () => true,
    offerSteering: (_chatId: string, input: SteeringInput) => {
      offered.push(input);
      return true;
    },
    clearSteering: () => {
      clears += 1;
      return true;
    },
  } as unknown as RunService;
  const service = new QueuedMessageService({
    repo,
    chats: { get: () => ({ id: CHAT }) } as never,
    runs,
    clock: { now: () => 0 },
    sink: { emit: () => undefined },
    resolveFile: () => undefined,
  });
  return { service, offered, clears: () => clears };
}

describe('batch steering delivery', () => {
  it('offers every contiguous steering input in FIFO order', () => {
    const { service, offered } = harness([
      pending('queued-A1b2C3d4E5f'),
      pending('queued-F6g7H8i9J0k'),
      pending('queued-L1m2N3o4P5q'),
    ]);

    expect(service.offerSteering(CHAT)).toBe(true);
    expect(offered.map((input) => input.id)).toEqual([
      'queued-A1b2C3d4E5f',
      'queued-F6g7H8i9J0k',
      'queued-L1m2N3o4P5q',
    ]);
  });

  it('treats explicit follow-up as a FIFO barrier', () => {
    const { service, offered } = harness([
      pending('queued-A1b2C3d4E5f'),
      pending('queued-R6s7T8u9V0w', 'follow_up'),
      pending('queued-X1y2Z3a4B5c'),
    ]);

    expect(service.offerSteering(CHAT)).toBe(true);
    expect(offered.map((input) => input.id)).toEqual(['queued-A1b2C3d4E5f']);
  });

  it('rebuilds the whole native batch in durable order after an edit', () => {
    const { service, offered, clears } = harness([
      pending('queued-A1b2C3d4E5f'),
      pending('queued-F6g7H8i9J0k'),
      pending('queued-L1m2N3o4P5q'),
    ]);
    service.offerSteering(CHAT);
    offered.length = 0;

    const result = service.update(CHAT, 'queued-F6g7H8i9J0k', {
      text: 'edited two',
      attachments: [],
      filePaths: [],
    });

    expect(result.ok).toBe(true);
    expect(clears()).toBe(1);
    expect(offered.map((input) => input.text)).toEqual([
      'queued-A1b2C3d4E5f',
      'edited two',
      'queued-L1m2N3o4P5q',
    ]);
  });
});
