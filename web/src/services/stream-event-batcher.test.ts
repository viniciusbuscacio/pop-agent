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
