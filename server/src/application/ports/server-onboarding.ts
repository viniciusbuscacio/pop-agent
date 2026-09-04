export interface ServerOnboardingRecord {
  version: 1;
  phase: 'pairing' | 'paired' | 'secure';
  codeSalt: string;
  codeDigest: string;
  codeExpiresAt: number;
  failedAttempts: number;
  lockedUntil?: number;
  tokenDigest?: string;
  secureUrl?: string;
}

export interface ServerOnboardingRepo {
  read(): ServerOnboardingRecord | undefined;
  write(record: ServerOnboardingRecord): void;
  remove(): void;
}

export interface TailnetStatus {
  installed: boolean;
  connected: boolean;
  dnsName?: string;
  serve: 'none' | 'ours' | 'conflict';
}

export interface TailscaleGateway {
  status(): TailnetStatus;
  beginLogin(): Promise<string | undefined>;
  enableHttps(hostname?: string):
    | { ok: true; secureUrl: string }
    | { ok: false; reason: 'not_installed' | 'not_connected' | 'conflict' | 'failed' }
    | { ok: false; reason: 'approval_required'; approvalUrl: string };
}
