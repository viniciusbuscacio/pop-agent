import type { StreamEvent } from '@pop-agent/shared';

type Deliver = (event: StreamEvent) => void;
type Schedule = (flush: () => void) => number;
type Cancel = (handle: number) => void;

/**
 * Streaming fragments can arrive much faster than a browser can paint. Fold
 * them into one animation frame so React sees one visual update per frame,
 * while lifecycle events still cross the boundary immediately and in order.
 */
export function createStreamEventBatcher(
  deliver: Deliver,
  schedule: Schedule = scheduleFrame,
  cancel: Cancel = cancelFrame,
): { push: (event: StreamEvent) => void; clear: () => void } {
  let queued: StreamEvent[] = [];
  let scheduled: number | undefined;

  const flush = (): void => {
    if (scheduled !== undefined) cancel(scheduled);
    scheduled = undefined;
    const events = queued;
    queued = [];
    for (const event of events) deliver(event);
  };

  return {
    push(event) {
      if (!isStreamingFragment(event)) {
        flush();
        deliver(event);
        return;
      }

      queued.push(event);
      scheduled ??= schedule(flush);
    },

    clear() {
      if (scheduled !== undefined) cancel(scheduled);
      scheduled = undefined;
      queued = [];
    },
  };
}

function isStreamingFragment(event: StreamEvent): boolean {
  return event.kind === 'delta' || event.kind === 'thinking' || event.kind === 'tool';
}

function scheduleFrame(flush: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(flush);
  return setTimeout(flush, 16) as unknown as number;
}

function cancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}
