export type DeploymentPhase =
  | 'current'
  | 'pending'
  | 'waiting-idle'
  | 'restarting'
  | 'healthy'
  | 'rolling-back'
  | 'rolled-back'
  | 'failed';

export interface DeploymentRecord {
  phase: DeploymentPhase;
  runningCommit: string;
  targetCommit: string;
  lastKnownGood: string;
  requestedAt?: string;
  updatedAt: string;
  error?: string;
  failedRef?: string;
}

export interface DeploymentStatus {
  runningCommit: string;
  headCommit: string;
  lastKnownGood: string;
  pending: boolean;
  clean: boolean;
  phase: DeploymentPhase;
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
}

export interface DeploymentSupervisor {
  start(plan: {
    runningCommit: string;
    targetCommit: string;
    lastKnownGood: string;
  }): void;
}
