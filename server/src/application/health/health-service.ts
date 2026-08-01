import type { ProviderService } from '../providers/provider-service.js';

/**
 * The probe's report, defined here because application code must not import
 * the wire contract (architecture rule); `shared/HealthResponse` mirrors it
 * and the HTTP layer marries the two.
 */
export interface HealthReport {
  server: 'ok';
  provider: 'ok' | 'error';
  db: 'ok' | 'error';
}

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

  report(): HealthReport {
    let db: HealthReport['db'] = 'ok';
    try {
      this.deps.pingDb();
    } catch {
      db = 'error';
    }

    let provider: HealthReport['provider'] = 'ok';
    if (!this.deps.providers.activeConfigured()) {
      // No key anywhere: every run would fail, so the light is honestly red.
      provider = 'error';
    } else if (this.lastRunFailed === true) {
      provider = 'error';
    }

    return { server: 'ok', provider, db };
  }
}
