import { describe, expect, it } from 'vitest';
import type { ProviderService } from '../providers/provider-service.js';
import { HealthService } from './health-service.js';

function providers(configured: boolean): ProviderService {
  return {
    activeConfigured: () => configured,
  } as unknown as ProviderService;
}

function health(configured: boolean, pingDb: () => void = () => undefined): HealthService {
  return new HealthService({ providers: providers(configured), pingDb });
}

describe('HealthService', () => {
  it('is all ok when configured, the db answers and no run has failed', () => {
    const service = health(true);
    expect(service.report()).toEqual({ server: 'ok', provider: 'ok', db: 'ok' });
  });

  it('reports the provider as error when no key is configured', () => {
    expect(health(false).report().provider).toBe('error');
  });

  it('reports the provider as error after a failed run, and recovers after a good one', () => {
    const service = health(true);
    service.noteRun(true, 'operation_error');
    expect(service.report().provider).toBe('error');
    service.noteRun(false);
    expect(service.report().provider).toBe('ok');
  });

  it('ignores a user-stopped run: aborted is not a provider problem', () => {
    const service = health(true);
    service.noteRun(true, 'aborted');
    expect(service.report().provider).toBe('ok');
  });

  it('reports the db as error when the ping throws', () => {
    const service = health(true, () => {
      throw new Error('disk gone');
    });
    expect(service.report().db).toBe('error');
  });
});
