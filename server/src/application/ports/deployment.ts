export type DeploymentPhase =
  | 'current'
  | 'pending'
  | 'waiting-idle'
  | 'restarting'
  | 'healthy'
  | 'rolling-back'
  | 'rolled-back'
  | 'cancelled'
  | 'superseded'
  | 'failed';

export type DeploymentRequester = 'manual' | 'automatic';

export interface DeploymentRecord {
  phase: DeploymentPhase;
  runningCommit: string;
  targetCommit: string;
  lastKnownGood: string;
  requestedBy?: DeploymentRequester;
  requestedAt?: string;
  updatedAt: string;
  error?: string;
  failedRef?: string;
  notifiedAt?: string;
}

export interface DeploymentStatus {
  runningCommit: string;
  headCommit: string;
  lastKnownGood: string;
  pending: boolean;
  clean: boolean;
  prepared: boolean;
  phase: DeploymentPhase;
  requestedBy?: DeploymentRequester;
  error?: string;
  failedRef?: string;
}

export interface DeploymentStateStore {
  read(): DeploymentRecord | undefined;
  write(record: DeploymentRecord): void;
}

export interface DeploymentInspector {
  headCommit(): string;
  isClean(): boolean;
  /** True only when the current committed tree exactly matches the last green gate receipt. */
  isPrepared(commit: string): boolean;
}

export interface DeploymentSupervisor {
  start(plan: {
    runningCommit: string;
    targetCommit: string;
    lastKnownGood: string;
    requestedBy: DeploymentRequester;
  }): void;
}
