import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../ports/clock.js';
import type {
  ServerOnboardingRecord,
  ServerOnboardingRepo,
  TailscaleGateway,
} from '../ports/server-onboarding.js';

const MAX_PAIR_FAILURES = 5;
const LOCK_MS = 60_000;

export interface ServerOnboardingView {
  required: boolean;
  phase: 'pairing' | 'tailscale' | 'https' | 'secure' | 'blocked';
  tailscaleInstalled: boolean;
  tailscaleConnected: boolean;
  loginUrl?: string;
  approvalUrl?: string;
  secureUrl?: string;
  issue?: 'code_expired' | 'tailscale_missing' | 'serve_conflict' | 'tailscale_failed';
}

export type PairResult =
  | { ok: true; token: string; state: ServerOnboardingView }
  | { ok: false; reason: 'not_required' | 'invalid_code' | 'expired' | 'locked' };

export class ServerOnboardingService {
  constructor(private readonly deps: {
    repo: ServerOnboardingRepo;
    tailscale: TailscaleGateway;
    clock: Clock;
  }) {}

  publicState(): {
    required: boolean;
    phase: 'pairing' | 'secure';
    codeExpiresAt?: string;
    secureUrl?: string;
  } {
    const record = this.deps.repo.read();
    if (record === undefined) return { required: false, phase: 'secure' };
    if (record.phase === 'secure') {
      return {
        required: true,
        phase: 'secure',
        ...(record.secureUrl === undefined ? {} : { secureUrl: record.secureUrl }),
      };
    }
    return {
      required: true,
      phase: 'pairing',
      codeExpiresAt: new Date(record.codeExpiresAt).toISOString(),
    };
  }

  requiresNetworkSetup(): boolean {
    const record = this.deps.repo.read();
    return record !== undefined && record.phase !== 'secure';
  }

  allowsAccountSetup(): boolean {
    const record = this.deps.repo.read();
    return record === undefined || record.phase === 'secure';
  }

  pair(code: string): PairResult {
    const record = this.deps.repo.read();
    if (record === undefined || record.phase !== 'pairing') {
      return { ok: false, reason: 'not_required' };
    }
    const now = this.deps.clock.now();
    if ((record.lockedUntil ?? 0) > now) return { ok: false, reason: 'locked' };
    if (record.codeExpiresAt <= now) return { ok: false, reason: 'expired' };

    const candidate = digest(record.codeSalt, normalizeCode(code));
    if (!sameDigest(candidate, record.codeDigest)) {
      const failures = record.failedAttempts + 1;
      this.deps.repo.write({
        ...record,
        failedAttempts: failures >= MAX_PAIR_FAILURES ? 0 : failures,
        ...(failures >= MAX_PAIR_FAILURES ? { lockedUntil: now + LOCK_MS } : {}),
      });
      return { ok: false, reason: 'invalid_code' };
    }

    const token = randomBytes(32).toString('base64url');
    const paired: ServerOnboardingRecord = {
      ...record,
      phase: 'paired',
      failedAttempts: 0,
      tokenDigest: digest(record.codeSalt, token),
    };
    delete paired.lockedUntil;
    this.deps.repo.write(paired);
    return { ok: true, token, state: this.stateForRecord(paired) };
  }

  state(token: string): ServerOnboardingView | undefined {
    const record = this.authorizedRecord(token);
    return record === undefined ? undefined : this.stateForRecord(record);
  }

  async connect(token: string): Promise<ServerOnboardingView | undefined> {
    const record = this.authorizedRecord(token);
    if (record === undefined) return undefined;
    const loginUrl = await this.deps.tailscale.beginLogin();
    const state = this.stateForRecord(record);
    return loginUrl === undefined ? state : { ...state, loginUrl };
  }

  async enableHttps(
    token: string,
    acceptedCertificateTransparency: boolean,
    hostname?: string,
  ): Promise<
    | { ok: true; state: ServerOnboardingView }
    | { ok: false; reason: 'approval_required'; approvalUrl: string }
    | { ok: false; reason: 'invalid_token' | 'notice_required' | 'invalid_hostname' | 'not_ready' | 'conflict' | 'failed' }> {
    const record = this.authorizedRecord(token);
    if (record === undefined) return { ok: false, reason: 'invalid_token' };
    if (!acceptedCertificateTransparency) return { ok: false, reason: 'notice_required' };
    if (hostname !== undefined && !validHostname(hostname)) {
      return { ok: false, reason: 'invalid_hostname' };
    }

    const result = this.deps.tailscale.enableHttps(hostname);
    if (!result.ok) {
      if (result.reason === 'approval_required') {
        return { ok: false, reason: 'approval_required', approvalUrl: result.approvalUrl };
      }
      if (result.reason === 'conflict') return { ok: false, reason: 'conflict' };
      if (result.reason === 'not_connected' || result.reason === 'not_installed') {
        return { ok: false, reason: 'not_ready' };
      }
      return { ok: false, reason: 'failed' };
    }

    if (!await this.deps.tailscale.verifyHttps(result.secureUrl)) return { ok: false, reason: 'failed' };
    const current = this.authorizedRecord(token);
    if (current === undefined) return { ok: false, reason: 'invalid_token' };
    const secure: ServerOnboardingRecord = {
      ...current,
      phase: 'secure',
      secureUrl: result.secureUrl,
    };
    this.deps.repo.write(secure);
    return { ok: true, state: this.stateForRecord(secure) };
  }

  complete(): void {
    this.deps.repo.remove();
  }

  private authorizedRecord(token: string): ServerOnboardingRecord | undefined {
    const record = this.deps.repo.read();
    if (record === undefined || record.phase === 'pairing' || record.tokenDigest === undefined) {
      return undefined;
    }
    return sameDigest(digest(record.codeSalt, token), record.tokenDigest) ? record : undefined;
  }

  private stateForRecord(record: ServerOnboardingRecord): ServerOnboardingView {
    if (record.phase === 'secure') {
      return {
        required: true,
        phase: 'secure',
        tailscaleInstalled: true,
        tailscaleConnected: true,
        ...(record.secureUrl === undefined ? {} : { secureUrl: record.secureUrl }),
      };
    }
    const status = this.deps.tailscale.status();
    if (!status.installed) {
      return {
        required: true,
        phase: 'blocked',
        tailscaleInstalled: false,
        tailscaleConnected: false,
        issue: 'tailscale_missing',
      };
    }
    if (!status.connected) {
      return {
        required: true,
        phase: 'tailscale',
        tailscaleInstalled: true,
        tailscaleConnected: false,
      };
    }
    if (status.serve === 'conflict') {
      return {
        required: true,
        phase: 'blocked',
        tailscaleInstalled: true,
        tailscaleConnected: true,
        issue: 'serve_conflict',
      };
    }
    // A configured proxy is not proof of DNS, certificate or HTTP readiness.
    // Only the explicit activation path persists secure after the async probe.
    return {
      required: true,
      phase: 'https',
      tailscaleInstalled: true,
      tailscaleConnected: true,
    };
  }
}

function normalizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, '');
}

function digest(salt: string, value: string): string {
  return createHash('sha256').update(salt).update('\0').update(value).digest('hex');
}

function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

function validHostname(value: string): boolean {
  return value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}
