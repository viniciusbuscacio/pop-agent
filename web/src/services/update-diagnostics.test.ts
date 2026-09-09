// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
beforeEach(() => { localStorage.clear(); vi.resetModules(); vi.restoreAllMocks(); });
it('persists bounded logs across module reloads without raw error details', async () => {
  const logs = await import('./update-diagnostics');
  for (let i = 0; i < 105; i++) logs.logUpdate('check', 'failed', Date.now(), undefined, new TypeError('https://private/?token=secret'));
  const text = logs.updateDiagnostics();
  expect(JSON.parse(text).entries).toHaveLength(100);
  expect(text).toContain('TypeError'); expect(text).not.toContain('secret'); expect(text).not.toContain('https');
  vi.resetModules();
  expect((await import('./update-diagnostics')).updateDiagnostics()).toBe(text);
});
it('keeps diagnostics usable when persistent storage is denied', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
  const logs = await import('./update-diagnostics');
  expect(() => logs.logUpdate('activated', 'timeout', Date.now() - 10_000, undefined, new Error('Update phase timed out'))).not.toThrow();
  expect(JSON.parse(logs.updateDiagnostics()).entries[0]).toMatchObject({ phase: 'activated', outcome: 'timeout', reason: 'timeout', elapsedMs: expect.any(Number) });
});
it('does not re-export unrecognized fields in stored entries', async () => {
  localStorage.setItem('pop-agent-update-log-v1', JSON.stringify([{ at: '2026-09-09T00:00:00.000Z', phase: 'check', outcome: 'success', elapsedMs: 1, worker: 'none', build: 'unknown', reason: 'none', token: 'secret' }]));
  const logs = await import('./update-diagnostics');
  expect(logs.updateDiagnostics()).not.toContain('secret');
});
