import { afterEach, expect, it, vi } from 'vitest';
import { UiBridgeService } from './ui-bridge-service.js';
afterEach(() => vi.useRealTimers());
it('isolates tabs, delivers once, rejects concurrent actions and requires the tab key', async () => {
  const bridge = new UiBridgeService(); const a = bridge.register('A'); const b = bridge.register('B');
  expect(JSON.stringify(bridge.list())).not.toContain(a.key);
  const result = bridge.dispatch(a.id, { kind: 'input', testid: 'editor', value: 'hello' });
  await expect(bridge.dispatch(a.id, { kind: 'press', testid: 'save' })).rejects.toThrow('ui_busy');
  expect(bridge.poll(b.id, b.key)).toBeNull();
  expect(() => bridge.poll(a.id, b.key)).toThrow('ui_not_connected');
  const command = bridge.poll(a.id, a.key)!;
  expect(bridge.poll(a.id, a.key)).toBeNull();
  expect(() => bridge.acknowledge(a.id, b.key, command.id, {})).toThrow('ui_not_connected');
  bridge.acknowledge(a.id, a.key, command.id, { state: { title: 'Updated' } });
  expect(await result).toEqual({ state: { title: 'Updated' } });
});
it('revocation prevents queued commands from reaching the tab', async () => {
  const bridge = new UiBridgeService(); const tab = bridge.register('A');
  const result = bridge.dispatch(tab.id, { kind: 'press' }, () => { throw new Error('revoked'); });
  expect(bridge.poll(tab.id, tab.key)).toBeNull();
  expect(await result).toMatchObject({ error: { code: 'ui_access_revoked' } });
});
it('timeouts disconnect the tab so a late action cannot overlap a new command', async () => {
  vi.useFakeTimers(); const bridge = new UiBridgeService(); const tab = bridge.register('A');
  const result = bridge.dispatch(tab.id, { kind: 'press' });
  bridge.poll(tab.id, tab.key);
  await vi.advanceTimersByTimeAsync(8000);
  expect(await result).toMatchObject({ error: { code: 'ui_timeout' } });
  await expect(bridge.dispatch(tab.id, { kind: 'press' })).rejects.toThrow('ui_not_connected');
});
it('disconnect resolves in-flight work and stale tabs expire', async () => {
  vi.useFakeTimers(); const bridge = new UiBridgeService(); const tab = bridge.register('A');
  const result = bridge.dispatch(tab.id, { kind: 'state' });
  bridge.remove(tab.id, tab.key);
  expect(await result).toMatchObject({ error: { code: 'ui_disconnected' } });
  bridge.register('B'); await vi.advanceTimersByTimeAsync(45_001); expect(bridge.list()).toEqual([]);
});
