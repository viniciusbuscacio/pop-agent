import { expect, it, vi } from 'vitest';
import { createCoalescedWriter } from './coalesced-writer';
it('coalesces bursts and serializes writes, including deletion after an in-flight write', async () => {
  const writer = createCoalescedWriter(); const calls: string[] = [];
  let release!: () => void;
  const first = writer.add('a', async () => { calls.push('first'); await new Promise<void>(done => { release = done; }); });
  await Promise.resolve();
  const old = writer.add('a', async () => { calls.push('old'); });
  const latest = writer.add('a', async () => { calls.push('latest'); });
  expect(old).toBe(latest);
  const other = writer.add('b', async () => { calls.push('other'); });
  expect(calls).toEqual(['first']);
  release(); await Promise.all([first, latest, other]);
  expect(calls).toEqual(['first', 'latest', 'other']);
});
it('discards pending session snapshots on clear', async () => {
  const writer = createCoalescedWriter(); const write = vi.fn(async () => {});
  const pending = writer.add('private', write); writer.clear(); await pending;
  await Promise.resolve(); expect(write).not.toHaveBeenCalled();
});
it('continues writing independent snapshots after an operation fails', async () => {
  const writer = createCoalescedWriter(); const next = vi.fn(async () => {});
  const failed = writer.add('bad', async () => { throw new Error('denied'); });
  const good = writer.add('good', next);
  await expect(failed).rejects.toThrow('denied'); await good;
  expect(next).toHaveBeenCalledOnce();
});
