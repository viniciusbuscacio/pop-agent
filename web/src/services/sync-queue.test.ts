import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSyncQueue } from './sync-queue';

afterEach(() => vi.useRealTimers());
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

describe('finite synchronization queue', () => {
  it('serializes background reads, deduplicates keys and stops after completion', async () => {
    const queue = createSyncQueue();
    const first = deferred(); const calls: string[] = [];
    const a = queue.add('a', async () => { calls.push('a'); await first.promise; });
    const duplicate = queue.add('a', async () => { calls.push('duplicate'); });
    const b = queue.add('b', async () => { calls.push('b'); });
    await Promise.resolve();
    expect(calls).toEqual(['a']); expect(a).toBe(duplicate);
    first.resolve(); await Promise.all([a, b]);
    expect(calls).toEqual(['a', 'b']); expect(queue.getState().busy).toBe(false);
  });
  it('promotes navigation past a blocked background read without restarting it', async () => {
    const queue = createSyncQueue(); const blocked = deferred(); const calls: string[] = [];
    const a = queue.add('background', async () => { calls.push('background'); await blocked.promise; });
    const b = queue.add('later', async () => { calls.push('later'); });
    const page = queue.add('page', async () => { calls.push('page'); });
    queue.promote('page'); await page;
    expect(calls).toEqual(['background', 'page']);
    blocked.resolve(); await Promise.all([a, b]); expect(calls).toEqual(['background', 'page', 'later']);
  });
  it('aborts a hung read, continues the queue and retains its error without retry loops', async () => {
    vi.useFakeTimers(); const queue = createSyncQueue(100); let signal!: AbortSignal;
    const hung = queue.add('hung', async abort => { signal = abort; await new Promise(() => undefined); });
    const next = vi.fn(async () => undefined); const done = queue.add('next', next);
    await vi.advanceTimersByTimeAsync(101); await Promise.all([hung, done]);
    expect(signal.aborted).toBe(true); expect(next).toHaveBeenCalledOnce();
    expect(queue.getState()).toEqual({ busy: false, errors: ['hung'] });
    await vi.advanceTimersByTimeAsync(60_000); expect(next).toHaveBeenCalledOnce();
  });
  it('logout aborts active reads, drops queued work and ignores late completions', async () => {
    const queue = createSyncQueue(); const first = deferred(); const next = vi.fn(async () => undefined);
    const a = queue.add('a', () => first.promise); const b = queue.add('b', next);
    queue.stop(); first.resolve(); await Promise.all([a, b]);
    expect(next).not.toHaveBeenCalled(); expect(queue.getState().busy).toBe(false);
  });
});
