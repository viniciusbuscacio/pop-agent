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
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let bytes = 0;

  const flush = (): void => {
    if (scheduled !== undefined) cancel(scheduled);
    scheduled = undefined;
    if (deadline !== undefined) clearTimeout(deadline);
    deadline = undefined;
    bytes = 0;
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
      // Bound retention even if background frames AND timers are throttled.
      bytes += JSON.stringify(event).length * 2;
      if (queued.length >= 256 || bytes >= 256 * 1024) { flush(); return; }
      scheduled ??= schedule(flush);
      deadline ??= setTimeout(flush, 100);
    },

    clear() {
      if (scheduled !== undefined) cancel(scheduled);
      scheduled = undefined;
      queued = [];
      bytes = 0;
      if (deadline !== undefined) clearTimeout(deadline);
      deadline = undefined;
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
