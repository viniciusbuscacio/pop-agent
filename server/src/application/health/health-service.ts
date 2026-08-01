import type { HealthResponse } from '@popy/shared';
import type { ProviderService } from '../providers/provider-service.js';

export interface HealthServiceDeps {
  providers: ProviderService;
  /** Throws when the database cannot answer a trivial query. */
  pingDb: () => void;
}

/**
 * The sidebar's health probe (popy.spec §13): cheap enough to be polled
 * every few seconds. The server field is trivially 'ok' -- a process that
 * cannot serve HTTP never answers at all, and the frontend reads that as
 * "Server offline". The provider signal is deliberately cached state, not a
 * live call: a paid round trip per poll is out of the question, so health
 * reports the configuration plus the outcome of the last run, which is what
 * "connected but degraded" means in practice.
 */
export class HealthService {
  private lastRunFailed: boolean | undefined;

  constructor(private readonly deps: HealthServiceDeps) {}

  /**
   * The run service reports every finished run here. A user-stopped run
   * (code 'aborted') is not a provider problem and must not turn the light
   * red -- only a real failure does.
   */
  noteRun(failed: boolean, code?: string): void {
    if (code === 'aborted') return;
    this.lastRunFailed = failed;
  }

  report(): HealthResponse {
    let db: HealthResponse['db'] = 'ok';
    try {
      this.deps.pingDb();
    } catch {
      db = 'error';
    }

    let provider: HealthResponse['provider'] = 'ok';
    if (!this.deps.providers.status().configured) {
      // No key anywhere: every run would fail, so the light is honestly red.
      provider = 'error';
    } else if (this.lastRunFailed === true) {
      provider = 'error';
    }

    return { server: 'ok', provider, db };
  }
}
