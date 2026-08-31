import { beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../ports/clock.js';
import type { PasswordHasher } from '../ports/password-hasher.js';
import type { SecretsRepo } from '../ports/secrets-repo.js';
import type { SettingsRepo } from '../ports/settings-repo.js';
import { AuthService } from './auth-service.js';

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const PASSWORD = 'correct horse battery';
const OTHER_PASSWORD = 'another good password';

class MemorySettings implements SettingsRepo {
  private readonly rows = new Map<string, string>();
  get<T>(key: string): T | undefined {
    const raw = this.rows.get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  set<T>(key: string, value: T): void {
    this.rows.set(key, JSON.stringify(value));
  }
}

class MemorySecrets implements SecretsRepo {
  private readonly rows = new Map<string, string>();
  get(key: string): string | undefined {
    return this.rows.get(key);
  }
  set(key: string, value: string): void {
    this.rows.set(key, value);
  }
  delete(key: string): void {
    this.rows.delete(key);
  }
}

/** Cheap stand-in for argon2: the real one is slow on purpose. */
const fakeHasher: PasswordHasher = {
  hash: (plaintext) => Promise.resolve(`hashed:${plaintext}`),
  verify: (hash, plaintext) => Promise.resolve(hash === `hashed:${plaintext}`),
};

class FakeClock implements Clock {
  constructor(private value: number) {}
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

let clock: FakeClock;
let auth: AuthService;

async function completeSetup(): Promise<{ token: string; recoveryKey: string }> {
  const result = await auth.setup(PASSWORD);
  if (!result.ok) throw new Error('setup failed');
  expect(auth.acknowledgeSetup()).toBe(true);
  return result;
}

beforeEach(() => {
  clock = new FakeClock(NOW);
  auth = new AuthService({
    settings: new MemorySettings(),
    secrets: new MemorySecrets(),
    hasher: fakeHasher,
    clock,
  });
});

describe('setup', () => {
  it('creates a pending account and completes only after the key is acknowledged', async () => {
    expect(auth.isSetupDone()).toBe(false);

    const result = await auth.setup(PASSWORD);

    expect(result.ok).toBe(true);
    expect(auth.isSetupDone()).toBe(false);
    if (result.ok) {
      expect(result.recoveryKey).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/);
      expect(auth.verifySession(result.token)).toEqual({ ok: false, reason: 'wrong_purpose' });
      expect(auth.verifySetupToken(result.token).ok).toBe(true);
      expect(auth.acknowledgeSetup()).toBe(true);
      expect(auth.verifySession(result.token).ok).toBe(true);
      expect(auth.isSetupDone()).toBe(true);
    }
  });

  it('refuses to run twice', async () => {
    await completeSetup();
    expect(await auth.setup(PASSWORD)).toEqual({ ok: false, reason: 'already_setup' });
  });

  it('resumes an unacknowledged setup only with the same password and rotates the lost key', async () => {
    const first = await auth.setup(PASSWORD);
    if (!first.ok) throw new Error('setup failed');

    expect(await auth.setup(OTHER_PASSWORD)).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });

    const resumed = await auth.setup(PASSWORD);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.recoveryKey).not.toBe(first.recoveryKey);
    expect(auth.verifySession(first.token)).toEqual({ ok: false, reason: 'stale_epoch' });
    expect(auth.verifySession(resumed.token)).toEqual({ ok: false, reason: 'wrong_purpose' });
    expect(auth.verifySetupToken(resumed.token).ok).toBe(true);
  });

  it('refuses a password under ten characters', async () => {
    expect(await auth.setup('short')).toEqual({ ok: false, reason: 'weak_password' });
    expect(auth.isSetupDone()).toBe(false);
  });
});

describe('login', () => {
  beforeEach(async () => {
    await completeSetup();
  });

  it('accepts the password and issues a valid token', async () => {
    const result = await auth.login(PASSWORD);

    expect(result.ok).toBe(true);
    if (result.ok) expect(auth.verifySession(result.token).ok).toBe(true);
  });

  it('rejects the wrong password', async () => {
    expect(await auth.login('wrong password here')).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
  });
});

describe('sessions', () => {
  it('expires after seven days', async () => {
    const result = await completeSetup();

    clock.advance(7 * DAY - 1);
    expect(auth.verifySession(result.token).ok).toBe(true);

    clock.advance(1);
    expect(auth.verifySession(result.token)).toEqual({ ok: false, reason: 'expired' });
  });

  it('revalidates a ticket-bound payload against expiry and epoch', async () => {
    const result = await completeSetup();
    const verified = auth.verifySession(result.token);
    if (!verified.ok) throw new Error('token should verify');

    expect(auth.isSessionCurrent(verified.payload)).toBe(true);
    auth.signOutOthers();
    expect(auth.isSessionCurrent(verified.payload)).toBe(false);

    const current = await auth.login(PASSWORD);
    if (!current.ok) throw new Error('login failed');
    const currentPayload = auth.verifySession(current.token);
    if (!currentPayload.ok) throw new Error('token should verify');
    clock.advance(7 * DAY);
    expect(auth.isSessionCurrent(currentPayload.payload)).toBe(false);
  });

  it('renews only once the token is over a day old', async () => {
    const result = await completeSetup();
    const verified = auth.verifySession(result.token);
    if (!verified.ok) throw new Error('token should verify');

    expect(auth.renewIfDue(verified.payload)).toBeUndefined();

    clock.advance(DAY + 1);
    const renewed = auth.renewIfDue(verified.payload);
    expect(renewed).toBeDefined();
    expect(renewed).not.toBe(result.token);
    expect(auth.verifySession(renewed as string).ok).toBe(true);
  });
});

describe('change password', () => {
  it('drops other sessions, rotates recovery, and keeps the caller signed in', async () => {
    const setup = await completeSetup();

    const changed = await auth.changePassword(PASSWORD, OTHER_PASSWORD);

    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(auth.verifySession(setup.token)).toEqual({ ok: false, reason: 'stale_epoch' });
    expect(auth.verifySession(changed.token).ok).toBe(true);
    expect(changed.recoveryKey).not.toBe(setup.recoveryKey);
    expect(await auth.recover(setup.recoveryKey, PASSWORD)).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
    expect((await auth.login(OTHER_PASSWORD)).ok).toBe(true);
  });

  it('refuses the wrong current password', async () => {
    await completeSetup();

    expect(await auth.changePassword('not the password', OTHER_PASSWORD)).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
    expect((await auth.login(PASSWORD)).ok).toBe(true);
  });

  it('refuses a weak new password and keeps the old one', async () => {
    await completeSetup();

    expect(await auth.changePassword(PASSWORD, 'short')).toEqual({
      ok: false,
      reason: 'weak_password',
    });
    expect((await auth.login(PASSWORD)).ok).toBe(true);
  });
});

describe('recovery', () => {
  it('sets a new password and burns the key it was given', async () => {
    const setup = await completeSetup();

    const recovered = await auth.recover(setup.recoveryKey, OTHER_PASSWORD);

    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.recoveryKey).not.toBe(setup.recoveryKey);
    expect((await auth.login(OTHER_PASSWORD)).ok).toBe(true);

    // The used key must not work a second time; the fresh one must.
    expect(await auth.recover(setup.recoveryKey, PASSWORD)).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
    expect((await auth.recover(recovered.recoveryKey, PASSWORD)).ok).toBe(true);
  });

  it('invalidates existing sessions and signs the caller in', async () => {
    const setup = await completeSetup();

    const recovered = await auth.recover(setup.recoveryKey, OTHER_PASSWORD);

    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(auth.verifySession(setup.token)).toEqual({ ok: false, reason: 'stale_epoch' });
    expect(auth.verifySession(recovered.token).ok).toBe(true);
  });

  it('rejects a key that was never issued', async () => {
    await completeSetup();

    expect(await auth.recover('ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2', OTHER_PASSWORD)).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });
  });

  it('keeps the current password when the new one is too weak', async () => {
    const setup = await completeSetup();

    expect(await auth.recover(setup.recoveryKey, 'short')).toEqual({
      ok: false,
      reason: 'weak_password',
    });
    expect((await auth.login(PASSWORD)).ok).toBe(true);
  });
});

describe('sign out other devices', () => {
  it('keeps this device and drops the rest', async () => {
    const first = await completeSetup();
    const second = await auth.login(PASSWORD);
    if (!second.ok) throw new Error('setup failed');

    const { token } = auth.signOutOthers();

    expect(auth.verifySession(second.token)).toEqual({ ok: false, reason: 'stale_epoch' });
    expect(auth.verifySession(first.token)).toEqual({ ok: false, reason: 'stale_epoch' });
    expect(auth.verifySession(token).ok).toBe(true);
  });
});
