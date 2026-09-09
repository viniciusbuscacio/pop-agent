import type { StreamEvent } from '@pop-agent/shared';
import { describe, expect, it, vi } from 'vitest';
import { createStreamEventBatcher } from './stream-event-batcher';

const delta = (seq: number, text: string): StreamEvent => ({
  kind: 'delta',
  chatId: 'chat-1',
  runId: 'run-1',
  seq,
  text,
});

describe('stream event batching', () => {
  it('delivers streaming fragments together on the next frame', () => {
    const delivered: StreamEvent[] = [];
    let frame: (() => void) | undefined;
    const batcher = createStreamEventBatcher(
      (event) => delivered.push(event),
      (flush) => {
        frame = flush;
        return 1;
      },
      vi.fn(),
    );

    batcher.push(delta(1, 'one'));
    batcher.push(delta(2, 'two'));

    expect(delivered).toEqual([]);
    expect(frame).toBeDefined();
    frame?.();
    expect(delivered).toEqual([delta(1, 'one'), delta(2, 'two')]);
  });

  it('flushes fragments before an immediate lifecycle event', () => {
    const delivered: StreamEvent[] = [];
    const cancel = vi.fn();
    const batcher = createStreamEventBatcher(
      (event) => delivered.push(event),
      () => 7,
      cancel,
    );
    const done: StreamEvent = {
      kind: 'done',
      chatId: 'chat-1',
      runId: 'run-1',
      messageId: 'message-1',
    };

    batcher.push(delta(1, 'answer'));
    batcher.push(done);

    expect(delivered).toEqual([delta(1, 'answer'), done]);
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it('drops buffered session data when cleared', () => {
    const deliver = vi.fn();
    let frame: (() => void) | undefined;
    const batcher = createStreamEventBatcher(
      deliver,
      (flush) => {
        frame = flush;
        return 3;
      },
      vi.fn(),
    );

    batcher.push(delta(1, 'private'));
    batcher.clear();
    frame?.();

    expect(deliver).not.toHaveBeenCalled();
  });
});

it('bounds background retention even when frames and timers cannot run', () => {
  vi.useFakeTimers();
  const delivered: StreamEvent[] = [];
  const batcher = createStreamEventBatcher(event => delivered.push(event), () => 1, vi.fn());
  for (let seq = 1; seq <= 100_000; seq++) batcher.push(delta(seq, 'part'));
  expect(100_000 - delivered.length).toBeLessThan(256);
  vi.advanceTimersByTime(100);
  expect(delivered).toHaveLength(100_000);
  expect(delivered.map(event => 'seq' in event ? event.seq : undefined)).toEqual(Array.from({ length: 100_000 }, (_, n) => n + 1));
  batcher.clear(); vi.useRealTimers();
});
it('flushes a small background queue by deadline and clears its timer on logout', () => {
  vi.useFakeTimers();
  const deliver = vi.fn();
  const batcher = createStreamEventBatcher(deliver, () => 1, vi.fn());
  batcher.push(delta(1, 'first')); vi.advanceTimersByTime(100);
  expect(deliver).toHaveBeenCalledExactlyOnceWith(delta(1, 'first'));
  batcher.push(delta(2, 'private')); batcher.clear(); vi.runAllTimers();
  expect(deliver).toHaveBeenCalledTimes(1); vi.useRealTimers();
});
it('flushes large fragments at the byte budget', () => {
  const deliver = vi.fn();
  const batcher = createStreamEventBatcher(deliver, () => 1, vi.fn());
  batcher.push(delta(1, 'x'.repeat(130 * 1024)));
  expect(deliver).toHaveBeenCalledTimes(1); batcher.clear();
});
