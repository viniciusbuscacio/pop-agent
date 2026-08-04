import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@popy/shared';
import { readEvents } from './events.js';

/** A body that hands out exactly the chunks given, in that order. */
function streamOf(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(body);
}

async function collect(chunks: string[]): Promise<StreamEvent[]> {
  const events: StreamEvent[] = [];
  for await (const event of readEvents(streamOf(chunks))) events.push(event);
  return events;
}

const frame = (event: unknown): string => `data: ${JSON.stringify(event)}\n\n`;

describe('readEvents', () => {
  it('reads the frames of a stream', async () => {
    const events = await collect([
      frame({ kind: 'delta', chatId: 'c', runId: 'r', seq: 0, text: 'hi' }),
      frame({ kind: 'done', chatId: 'c', runId: 'r', messageId: 'm' }),
    ]);
    expect(events.map((event) => event.kind)).toEqual(['delta', 'done']);
  });

  it('waits for a frame split across chunks', async () => {
    // TCP delivers where it likes, not where a message ends: treating every
    // chunk as a frame would produce a broken JSON parse per paragraph.
    const whole = frame({ kind: 'delta', chatId: 'c', runId: 'r', seq: 0, text: 'a paragraph' });
    const cut = Math.floor(whole.length / 2);
    const events = await collect([whole.slice(0, cut), whole.slice(cut)]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ text: 'a paragraph' });
  });

  it('reads several frames delivered in one chunk', async () => {
    const events = await collect([
      frame({ kind: 'delta', chatId: 'c', runId: 'r', seq: 0, text: 'a' }) +
        frame({ kind: 'delta', chatId: 'c', runId: 'r', seq: 1, text: 'b' }),
    ]);
    expect(events).toHaveLength(2);
  });

  it('skips what it cannot parse instead of killing the stream', async () => {
    // A heartbeat comment, or an event from a newer server: losing one is
    // always better than losing the answer that follows it.
    const events = await collect([
      ': keep-alive\n\n',
      'data: {not json\n\n',
      frame({ kind: 'done', chatId: 'c', runId: 'r', messageId: 'm' }),
    ]);
    expect(events.map((event) => event.kind)).toEqual(['done']);
  });

  it('ends quietly on a body that was never opened', async () => {
    expect(await collect([])).toEqual([]);
  });
});
