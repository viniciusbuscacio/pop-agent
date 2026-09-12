import type {
  PiActivationSupervisor,
  PiCandidateStateStore,
  PiCandidateStatus,
} from '../ports/pi-candidate.js';

export type PiActivationRequest =
  | { ok: true; status: PiCandidateStatus }
  | { ok: false; reason: 'candidate_not_ready' | 'already_current' | 'already_scheduled' };

/** Drains accepted work, closes admission, and hands pointer/restart/rollback outside the process. */
export class PiActivationService {
  private scheduled = false;

  constructor(
    private readonly deps: {
      activeVersion: string;
      state: PiCandidateStateStore;
      supervisor: PiActivationSupervisor;
      pauseTasks: () => void;
      resumeTasks: () => void;
      quiesceRuns: () => void;
      resumeRuns: () => void;
      waitForIdle: () => Promise<void>;
      now: () => string;
    },
  ) {
    const saved = deps.state.read();
    if (saved?.phase === 'waiting-idle') {
      deps.state.write({
        ...saved,
        phase: 'failed',
        error: 'Candidate activation was interrupted before handoff.',
        updatedAt: deps.now(),
      });
    } else if (saved?.phase === 'activating') {
      deps.state.write({
        ...saved,
        phase: saved.version === deps.activeVersion ? 'active' : 'failed',
        ...(saved.version === deps.activeVersion
          ? {}
          : { error: 'Candidate activation was interrupted before startup completed.' }),
        updatedAt: deps.now(),
      });
    } else if (saved?.phase === 'rolling-back' && saved.version !== deps.activeVersion) {
      deps.state.write({ ...saved, phase: 'rolled-back', updatedAt: deps.now() });
    }
  }

  request(): PiActivationRequest {
    if (this.scheduled) return { ok: false, reason: 'already_scheduled' };
    const candidate = this.deps.state.read();
    if (candidate?.phase !== 'ready' || candidate.version === undefined || candidate.integrity === undefined) {
      if (candidate?.phase === 'waiting-idle' || candidate?.phase === 'activating' || candidate?.phase === 'rolling-back') {
        return { ok: false, reason: 'already_scheduled' };
      }
      return { ok: false, reason: 'candidate_not_ready' };
    }
    if (candidate.version === this.deps.activeVersion) {
      return { ok: false, reason: 'already_current' };
    }

    this.scheduled = true;
    this.save({
      phase: 'waiting-idle',
      version: candidate.version,
      integrity: candidate.integrity,
    });
    void this.drainAndHandOff(candidate.version, candidate.integrity);
    return { ok: true, status: this.deps.state.read() ?? candidate };
  }

  private async drainAndHandOff(targetVersion: string, integrity: string): Promise<void> {
    try {
      await this.deps.waitForIdle();
      this.deps.pauseTasks();
      this.deps.quiesceRuns();
      await this.deps.waitForIdle();
      const current = this.deps.state.read();
      if (current?.phase !== 'waiting-idle' || current.version !== targetVersion) {
        throw new Error('The validated pi candidate changed before activation.');
      }
      this.save({ ...current, phase: 'activating' });
      this.deps.supervisor.start({
        targetVersion,
        integrity,
        previousVersion: this.deps.activeVersion,
      });
    } catch (error: unknown) {
      this.scheduled = false;
      this.deps.resumeRuns();
      this.deps.resumeTasks();
      this.save({
        phase: 'failed',
        version: targetVersion,
        integrity,
        error: error instanceof Error ? error.message : 'Could not activate pi candidate.',
      });
    }
  }

  private save(status: PiCandidateStatus): void {
    const { error, ...rest } = status;
    this.deps.state.write({
      ...rest,
      ...(error === undefined ? {} : { error }),
      updatedAt: this.deps.now(),
    });
  }
}
