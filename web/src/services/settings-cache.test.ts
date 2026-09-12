import { describe, expect, it } from 'vitest';
import { safeSettingsSnapshot, settingsCache } from './settings-cache';

describe('persistent Settings cache policy', () => {
  it('retains document data but never arbitrary secret fields', () => {
    expect(safeSettingsSnapshot('memory', { doc: 'Text', hasBackup: true, token: 'secret', password: 'secret' })).toEqual({ doc: 'Text', hasBackup: true });
    expect(safeSettingsSnapshot('auth', { token: 'secret' })).toBeUndefined();
    expect(safeSettingsSnapshot('update-status', { deployment: { phase: 'restarting' } })).toBeUndefined();
  });
  it('rejects corrupt types before they can reach a component', () => {
    expect(safeSettingsSnapshot('memory', { doc: 1, hasBackup: true })).toBeUndefined();
    expect(safeSettingsSnapshot('providers', { providers: {} })).toBeUndefined();
    expect(safeSettingsSnapshot('storage', { totalBytes: NaN, entries: [] })).toBeUndefined();
  });
  it('never persists live computer presence or backup operations', () => {
    const result = safeSettingsSnapshot('devices', { machines: [{ machineId: 'm', hostname: 'Mac', platform: 'darwin', arch: 'arm64', clientVersion: '1', enabled: true, connected: true }] });
    expect(JSON.stringify(result)).not.toContain('connected');
    expect(safeSettingsSnapshot('backups', { backups: [], operation: { state: 'creating' }, password: 'secret' })).toEqual({ backups: [] });
  });
  it('continues without IndexedDB when storage is unavailable', async () => {
    expect(await settingsCache.read('memory')).toBeUndefined();
    await expect(settingsCache.write('memory', { version: 1, savedAt: 1, data: { doc: 'Text', hasBackup: false } })).resolves.toBeUndefined();
    expect(() => settingsCache.clear()).not.toThrow();
  });
});
