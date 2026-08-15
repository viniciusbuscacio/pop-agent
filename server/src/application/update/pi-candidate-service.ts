import type { SettingsService } from '../settings/settings-service.js';
import type { UpdateChecker } from '../ports/update-checker.js';
import type {
  PiCandidateInstaller,
  PiCandidateStateStore,
  PiCandidateStatus,
} from '../ports/pi-candidate.js';

export type PiCandidateRequest =
  | { ok: true; status: PiCandidateStatus }
  | { ok: false; reason: 'policy_keeps_current' | 'target_unavailable' | 'already_running' };

/** Stages and validates a pi runtime candidate, but deliberately cannot activate it. */
export class PiCandidateService {
  private running = false;

  constructor(
    private readonly deps: {
      settings: SettingsService;
      updates: UpdateChecker;
      installer: PiCandidateInstaller;
      state: PiCandidateStateStore;
      now: () => string;
    },
  ) {
    const saved = deps.state.read();
    if (saved?.phase === 'installing' || saved?.phase === 'validating') {
      deps.state.write({
        ...saved,
        phase: 'failed',
        error: 'Candidate preparation was interrupted before validation completed.',
        updatedAt: deps.now(),
      });
    }
  }

  status(): PiCandidateStatus {
    return this.deps.state.read() ?? { phase: 'idle' };
  }

  async prepare(): Promise<PiCandidateRequest> {
    if (this.running) return { ok: false, reason: 'already_running' };
    const policy = this.deps.settings.read().piUpdatePolicy;
    if (policy === 'keep-current') return { ok: false, reason: 'policy_keeps_current' };

    const versions = await this.deps.updates.status({ refresh: policy === 'latest' });
    const target = policy === 'recommended' ? versions.pi.recommended : versions.pi.latest;
    if (target === undefined) return { ok: false, reason: 'target_unavailable' };

    this.running = true;
    this.save({ phase: 'installing', version: target });
    void this.run(target);
    return { ok: true, status: this.status() };
  }

  private async run(version: string): Promise<void> {
    try {
      const candidate = await this.deps.installer.prepare(version, () => {
        this.save({ phase: 'validating', version });
      });
      this.save({ phase: 'ready', ...candidate });
    } catch (error: unknown) {
      this.save({
        phase: 'failed',
        version,
        error: error instanceof Error ? error.message : 'Candidate validation failed.',
      });
    } finally {
      this.running = false;
    }
  }

  private save(status: PiCandidateStatus): void {
    this.deps.state.write({ ...status, updatedAt: this.deps.now() });
  }
}
