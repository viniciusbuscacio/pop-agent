import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, SettingsService } from '../settings/settings-service.js';
import type { SettingsRepo } from '../ports/settings-repo.js';
import type { PiCandidateStatus } from '../ports/pi-candidate.js';
import { PiCandidateService } from './pi-candidate-service.js';

class MemorySettings implements SettingsRepo {
  value: unknown;
  get<T>(): T | undefined { return this.value as T | undefined; }
  set<T>(_key: string, value: T): void { this.value = value; }
}

function setup(policy: typeof DEFAULT_SETTINGS.piUpdatePolicy = 'recommended') {
  const repo = new MemorySettings();
  const settings = new SettingsService(repo);
  settings.write({ ...DEFAULT_SETTINGS, piUpdatePolicy: policy });
  let state: PiCandidateStatus | undefined;
  let finish!: (value: { version: string; integrity: string }) => void;
  const installer = {
    prepare: vi.fn((_version: string, onValidating: () => void) => {
      onValidating();
      return new Promise<{ version: string; integrity: string }>((resolve) => { finish = resolve; });
    }),
  };
  const service = new PiCandidateService({
    settings,
    updates: { status: vi.fn().mockResolvedValue({
      pi: { current: '0.84.1', recommended: '0.84.1', latest: '0.85.0' },
      popAgent: { current: '0.2.30', latest: undefined }, node: 'v22', environment: [], updateCommand: '',
    }) },
    installer,
    state: { read: () => state, write: (next) => { state = next; } },
    now: () => '2026-08-15T00:00:00.000Z',
  });
  return { service, installer, finish: (value: { version: string; integrity: string }) => finish(value) };
}

describe('pi candidate service', () => {
  it('stages the recommended target and never exposes activation', async () => {
    const fixture = setup();
    expect(await fixture.service.prepare()).toMatchObject({ ok: true, status: { phase: 'validating' } });
    expect(fixture.installer.prepare).toHaveBeenCalledWith('0.84.1', expect.any(Function));
    fixture.finish({ version: '0.84.1', integrity: 'sha512-test' });
    await vi.waitFor(() => expect(fixture.service.status()).toMatchObject({ phase: 'ready', integrity: 'sha512-test' }));
  });

  it('uses latest only for the advanced policy and refuses keep-current', async () => {
    const latest = setup('latest');
    await latest.service.prepare();
    expect(latest.installer.prepare).toHaveBeenCalledWith('0.85.0', expect.any(Function));

    const fixed = setup('keep-current');
    expect(await fixed.service.prepare()).toEqual({ ok: false, reason: 'policy_keeps_current' });
    expect(fixed.installer.prepare).not.toHaveBeenCalled();
  });
});
