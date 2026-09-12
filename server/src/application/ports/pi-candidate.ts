export type PiCandidatePhase =
  | 'idle'
  | 'installing'
  | 'validating'
  | 'ready'
  | 'waiting-idle'
  | 'activating'
  | 'active'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed';

export interface PiCandidateStatus {
  phase: PiCandidatePhase;
  version?: string;
  integrity?: string;
  error?: string;
  updatedAt?: string;
}

export interface PiCandidateInstaller {
  prepare(version: string, onValidating: () => void): Promise<{ version: string; integrity: string }>;
}

export interface PiCandidateStateStore {
  read(): PiCandidateStatus | undefined;
  write(status: PiCandidateStatus): void;
}

export interface PiActivationSupervisor {
  start(plan: {
    targetVersion: string;
    integrity: string;
    previousVersion: string;
  }): void;
}
