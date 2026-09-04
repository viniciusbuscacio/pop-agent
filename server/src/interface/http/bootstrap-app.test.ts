import { describe, expect, it } from 'vitest';
import { ServerOnboardingService } from '../../application/onboarding/server-onboarding-service.js';
import type { ServerOnboardingRecord, ServerOnboardingRepo } from '../../application/ports/server-onboarding.js';
import { FakeClock, WEB_DIST } from '../../testing/app-fixture.js';
import { createBootstrapApp } from './bootstrap-app.js';

class Repo implements ServerOnboardingRepo {
  record: ServerOnboardingRecord | undefined = {
    version: 1,
    phase: 'pairing',
    codeSalt: '1'.repeat(32),
    codeDigest: '2'.repeat(64),
    codeExpiresAt: 1_700_000_060_000,
    failedAttempts: 0,
  };
  read() { return this.record; }
  write(record: ServerOnboardingRecord) { this.record = record; }
  remove() { this.record = undefined; }
}

describe('temporary HTTP bootstrap app', () => {
  it('mounts only setup metadata and onboarding, never credentials or product APIs', async () => {
    const app = createBootstrapApp({
      webDist: WEB_DIST,
      onboarding: new ServerOnboardingService({
        repo: new Repo(),
        clock: new FakeClock(),
        tailscale: {
          status: () => ({ installed: true, connected: false, serve: 'none' }),
          beginLogin: () => Promise.resolve('https://login.tailscale.com/a/abc123'),
          enableHttps: () => ({ ok: false, reason: 'not_connected' }),
        },
      }),
    });

    expect((await app.request('/v1/auth/state')).status).toBe(200);
    expect((await app.request('/v1/onboarding/public')).status).toBe(200);
    for (const path of ['/v1/setup', '/v1/login', '/v1/auth/recover', '/v1/settings', '/v1/chats']) {
      expect((await app.request(path, { method: 'POST' })).status, path).toBe(404);
    }
  });
});
