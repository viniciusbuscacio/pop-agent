import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ServerOnboardingRecord,
  ServerOnboardingRepo,
} from '../../application/ports/server-onboarding.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ONBOARDING_CODE_TTL_MS = 15 * 60_000;

export class JsonServerOnboardingRepo implements ServerOnboardingRepo {
  constructor(readonly path: string) {}

  read(): ServerOnboardingRecord | undefined {
    try {
      const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      return validRecord(value) ? value : undefined;
    } catch {
      return undefined;
    }
  }

  write(record: ServerOnboardingRecord): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }

  remove(): void {
    rmSync(this.path, { force: true });
  }
}

export function createServerOnboarding(
  repo: ServerOnboardingRepo,
  now: number,
): { code: string; expiresAt: number } {
  const code = Array.from(randomBytes(12), (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]!)
    .join('')
    .replace(/(.{4})(?=.)/g, '$1-');
  const salt = randomBytes(16).toString('hex');
  const expiresAt = now + ONBOARDING_CODE_TTL_MS;
  repo.write({
    version: 1,
    phase: 'pairing',
    codeSalt: salt,
    codeDigest: digest(salt, code.replaceAll('-', '')),
    codeExpiresAt: expiresAt,
    failedAttempts: 0,
  });
  return { code, expiresAt };
}

export function rotateServerOnboardingCode(
  repo: ServerOnboardingRepo,
  now: number,
): { code: string; expiresAt: number } | undefined {
  const current = repo.read();
  if (current === undefined || current.phase === 'secure') return undefined;
  return createServerOnboarding(repo, now);
}

function digest(salt: string, value: string): string {
  return createHash('sha256').update(salt).update('\0').update(value).digest('hex');
}

function validRecord(value: unknown): value is ServerOnboardingRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record['version'] === 1
    && (record['phase'] === 'pairing' || record['phase'] === 'paired' || record['phase'] === 'secure')
    && typeof record['codeSalt'] === 'string'
    && /^[a-f0-9]{32}$/.test(record['codeSalt'])
    && typeof record['codeDigest'] === 'string'
    && /^[a-f0-9]{64}$/.test(record['codeDigest'])
    && typeof record['codeExpiresAt'] === 'number'
    && Number.isFinite(record['codeExpiresAt'])
    && typeof record['failedAttempts'] === 'number'
    && Number.isInteger(record['failedAttempts'])
    && (record['lockedUntil'] === undefined || typeof record['lockedUntil'] === 'number')
    && (record['tokenDigest'] === undefined || (
      typeof record['tokenDigest'] === 'string' && /^[a-f0-9]{64}$/.test(record['tokenDigest'])
    ))
    && (record['secureUrl'] === undefined || (
      typeof record['secureUrl'] === 'string' && /^https:\/\/[a-z0-9.-]+\.ts\.net$/.test(record['secureUrl'])
    ))
  );
}
