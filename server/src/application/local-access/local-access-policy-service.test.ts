import { describe, expect, it } from 'vitest';
import { MemorySettings } from '../../testing/app-fixture.js';
import { LocalAccessPolicyService } from './local-access-policy-service.js';

const machine = {
  machineId: 'machine-m1', hostname: 'm1', platform: 'darwin', arch: 'arm64',
  cwd: '/Users/vinicius', clientVersion: '0.2.34',
};

describe('local access policy', () => {
  it('is disabled by default and survives service recreation', () => {
    const settings = new MemorySettings();
    const first = new LocalAccessPolicyService(settings);
    first.remember(machine);
    expect(first.enabled(machine.machineId)).toBe(false);

    expect(first.setEnabled(machine.machineId, true)).toBe(true);
    const restored = new LocalAccessPolicyService(settings);
    expect(restored.enabled(machine.machineId)).toBe(true);
    expect(restored.machines()).toEqual([expect.objectContaining({ machineId: 'machine-m1', enabled: true })]);
  });

  it('ignores unsafe identities and malformed persisted machine records', () => {
    const settings = new MemorySettings();
    const service = new LocalAccessPolicyService(settings);
    service.remember({ ...machine, machineId: '__proto__' });
    settings.set('local-machine-access', {
      machines: {
        broken: { machineId: 'broken', hostname: 42, enabled: true },
      },
    });
    expect(service.machines()).toEqual([]);
    expect(service.setEnabled('__proto__', true)).toBe(false);
  });

  it('keeps permission while refreshing machine metadata', () => {
    const service = new LocalAccessPolicyService(new MemorySettings());
    service.remember(machine);
    service.setEnabled(machine.machineId, true);
    service.remember({ ...machine, hostname: 'renamed-mac', clientVersion: '0.2.35' });
    expect(service.machines()).toEqual([
      expect.objectContaining({ hostname: 'renamed-mac', clientVersion: '0.2.35', enabled: true }),
    ]);
  });
});

it('persists removal and rejects old sign-ins even after a fresh binding is registered', () => {
  const settings = new MemorySettings();
  const policy = new LocalAccessPolicyService(settings);
  policy.remember(machine);
  policy.setEnabled(machine.machineId, true);
  expect(policy.remove(machine.machineId, 200)).toBe(true);
  const reloaded = new LocalAccessPolicyService(settings);
  expect(reloaded.machines()).toEqual([]);
  expect(reloaded.enabled(machine.machineId)).toBe(false);
  expect(reloaded.canAttach(machine.machineId, 199)).toBe(false);
  expect(reloaded.canAttach(machine.machineId, 200)).toBe(false);
  expect(reloaded.canAttach(machine.machineId)).toBe(false);
  expect(reloaded.canAttach(machine.machineId, 201)).toBe(true);
  reloaded.remember(machine);
  expect(reloaded.enabled(machine.machineId)).toBe(false);
  expect(reloaded.canAttach(machine.machineId, 199)).toBe(false);
});
