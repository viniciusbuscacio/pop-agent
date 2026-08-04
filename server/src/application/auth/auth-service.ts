import { randomBytes } from 'node:crypto';
import {
  generateRecoveryKey,
  hashRecoveryKey,
  recoveryKeyMatches,
} from '../../domain/auth/recovery-key.js';
import type { Clock } from '../ports/clock.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { SettingsRepo } from '../ports/settings-repo.js';
import { signToken, verifyToken, type TokenPayload, type VerifyResult } from './token.js';

/**
 * The single-user account (popy.spec §9): password login, recovery key, and an
 * epoch that invalidates every issued token at once.
 *
 * Where each piece lives, and why:
 * - the password and recovery-key hashes go in `settings`, because a hash is
 *   built to be stored;
 * - the HMAC secret goes in `secrets`, which is encrypted with the key file
 *   that stays out of backups -- so a leaked backup cannot be used to forge a
 *   session token.
 */

const AUTH_KEY = 'auth';
const SESSION_SECRET_KEY = 'session_hmac_secret';
const SESSION_SECRET_BYTES = 32;

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A token older than this gets silently replaced on the next request. */
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

interface AuthRecord {
  passwordHash: string;
  recoveryKeyHash: string;
  epoch: number;
  createdAt: string;
}

export interface AuthDeps {
  settings: SettingsRepo;
  secrets: SecretsRepo;
  hasher: PasswordHasher;
  clock: Clock;
}

export type SetupResult =
  | { ok: true; recoveryKey: string; token: string }
  | { ok: false; reason: 'already_setup' | 'weak_password' };

export type LoginResult = { ok: true; token: string } | { ok: false; reason: 'invalid_credentials' };

export type RecoverResult =
  | { ok: true; token: string; recoveryKey: string }
  | { ok: false; reason: 'invalid_credentials' | 'weak_password' };

export type ChangePasswordResult =
  | { ok: true; token: string }
  | { ok: false; reason: 'invalid_credentials' | 'weak_password' };

export class AuthService {
  constructor(private readonly deps: AuthDeps) {}

  isSetupDone(): boolean {
    return this.record() !== undefined;
  }

  async setup(password: string): Promise<SetupResult> {
    if (this.record() !== undefined) return { ok: false, reason: 'already_setup' };
    if (!isAcceptablePassword(password)) return { ok: false, reason: 'weak_password' };

    const recoveryKey = generateRecoveryKey();
    const record: AuthRecord = {
      passwordHash: await this.deps.hasher.hash(password),
      recoveryKeyHash: hashRecoveryKey(recoveryKey),
      epoch: 1,
      createdAt: new Date(this.deps.clock.now()).toISOString(),
    };

    // The secret is created before the record is written, so a crash in
    // between leaves no account that cannot mint tokens.
    this.deps.secrets.set(SESSION_SECRET_KEY, randomBytes(SESSION_SECRET_BYTES).toString('base64'));
    this.deps.settings.set(AUTH_KEY, record);

    return { ok: true, recoveryKey, token: this.issueToken(record.epoch) };
  }

  async login(password: string): Promise<LoginResult> {
    const record = this.record();
    if (record === undefined) return { ok: false, reason: 'invalid_credentials' };
    if (!(await this.deps.hasher.verify(record.passwordHash, password))) {
      return { ok: false, reason: 'invalid_credentials' };
    }
    return { ok: true, token: this.issueToken(record.epoch) };
  }

  /**
   * A session token on the current epoch, for a caller that has authenticated
   * some other way -- a passkey (popy.spec §9). Undefined before setup.
   */
  issueSessionToken(): string | undefined {
    const record = this.record();
    return record === undefined ? undefined : this.issueToken(record.epoch);
  }

  /**
   * Recovery burns the key it was given: a used key would otherwise stay valid
   * forever, which is a permanent master password nobody remembers handing
   * out. The caller must show the new one.
   */
  async recover(recoveryKey: string, newPassword: string): Promise<RecoverResult> {
    const record = this.record();
    if (record === undefined) return { ok: false, reason: 'invalid_credentials' };
    if (!recoveryKeyMatches(record.recoveryKeyHash, recoveryKey)) {
      return { ok: false, reason: 'invalid_credentials' };
    }
    if (!isAcceptablePassword(newPassword)) return { ok: false, reason: 'weak_password' };

    const nextRecoveryKey = generateRecoveryKey();
    const epoch = record.epoch + 1;
    this.deps.settings.set(AUTH_KEY, {
      ...record,
      passwordHash: await this.deps.hasher.hash(newPassword),
      recoveryKeyHash: hashRecoveryKey(nextRecoveryKey),
      epoch,
    } satisfies AuthRecord);

    return { ok: true, token: this.issueToken(epoch), recoveryKey: nextRecoveryKey };
  }

  /**
   * The way back in for whoever holds the shell (popy.spec §17): no current
   * password, no recovery key, because the case it exists for is having lost
   * both. `popyman reset-password` is the only caller, and it can only run on
   * the server itself, next to the database it is rewriting.
   *
   * It is deliberately NOT reachable over HTTP. Everything else here proves
   * something before it acts; this proves nothing, and the only thing keeping
   * it honest is that reaching it already means owning the machine. Exposing
   * it on a route would turn that into a password reset for anyone who found
   * the URL.
   *
   * Burns the recovery key too. Leaving the old one valid would mean a reset
   * that did not actually close the door it was called to close, and the
   * caller has to write the new one down.
   */
  async resetPassword(next: string): Promise<{ ok: true; recoveryKey: string } | { ok: false }> {
    const record = this.record();
    if (record === undefined) return { ok: false };
    if (!isAcceptablePassword(next)) return { ok: false };

    const recoveryKey = generateRecoveryKey();
    // The epoch bump is what signs every existing session out. A reset that
    // left them standing would hand the account back while whoever prompted
    // the reset kept their token.
    this.deps.settings.set(AUTH_KEY, {
      ...record,
      passwordHash: await this.deps.hasher.hash(next),
      recoveryKeyHash: hashRecoveryKey(recoveryKey),
      epoch: record.epoch + 1,
    } satisfies AuthRecord);

    return { ok: true, recoveryKey };
  }

  async changePassword(current: string, next: string): Promise<ChangePasswordResult> {
    const record = this.record();
    if (record === undefined) return { ok: false, reason: 'invalid_credentials' };
    if (!(await this.deps.hasher.verify(record.passwordHash, current))) {
      return { ok: false, reason: 'invalid_credentials' };
    }
    if (!isAcceptablePassword(next)) return { ok: false, reason: 'weak_password' };

    const epoch = record.epoch + 1;
    this.deps.settings.set(AUTH_KEY, {
      ...record,
      passwordHash: await this.deps.hasher.hash(next),
      epoch,
    } satisfies AuthRecord);

    return { ok: true, token: this.issueToken(epoch) };
  }

  /**
   * Bumps the epoch, then hands the caller a token on the new one: the device
   * that pressed the button stays signed in and every other session drops.
   */
  signOutOthers(): { token: string } {
    const record = this.requireRecord();
    const epoch = record.epoch + 1;
    this.deps.settings.set(AUTH_KEY, { ...record, epoch } satisfies AuthRecord);
    return { token: this.issueToken(epoch) };
  }

  verifySession(token: string): VerifyResult {
    const record = this.record();
    if (record === undefined) return { ok: false, reason: 'stale_epoch' };
    return verifyToken(token, this.sessionSecret(), this.deps.clock.now(), record.epoch);
  }

  /**
   * Sliding renewal: a token past its first day is swapped for a fresh one, so
   * somebody who opens Popy every week never meets the login screen, while a
   * token that has been idle for the full week still dies.
   */
  renewIfDue(payload: TokenPayload): string | undefined {
    const age = this.deps.clock.now() - payload.iat;
    return age > RENEW_AFTER_MS ? this.issueToken(payload.epoch) : undefined;
  }

  private issueToken(epoch: number): string {
    const now = this.deps.clock.now();
    return signToken({ epoch, iat: now, exp: now + SESSION_TTL_MS }, this.sessionSecret());
  }

  private sessionSecret(): Buffer {
    const stored = this.deps.secrets.get(SESSION_SECRET_KEY);
    if (stored === undefined) {
      throw new Error('session secret is missing: the account was never set up, or data was lost');
    }
    return Buffer.from(stored, 'base64');
  }

  private record(): AuthRecord | undefined {
    return this.deps.settings.get<AuthRecord>(AUTH_KEY);
  }

  private requireRecord(): AuthRecord {
    const record = this.record();
    if (record === undefined) throw new Error('no account has been set up yet');
    return record;
  }
}

export function isAcceptablePassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}
