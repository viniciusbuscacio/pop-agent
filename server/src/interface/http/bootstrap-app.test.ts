import { describe, expect, it } from 'vitest';
import { ONBOARDING_TOKEN_HEADER } from '@pop-agent/shared';
import { createServerOnboarding } from '../../infrastructure/onboarding/onboarding-state-file.js';
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
  it('carries pairing through state, Tailscale login and HTTPS activation', async () => {
    const repo = new Repo();
    const clock = new FakeClock();
    const { code } = createServerOnboarding(repo, clock.now());
    const app = createBootstrapApp({
      webDist: WEB_DIST,
      onboarding: new ServerOnboardingService({
        repo, clock,
        tailscale: {
          status: () => ({ installed: true, connected: false, serve: 'none' }),
          verifyHttps: () => Promise.resolve(true),
        beginLogin: () => Promise.resolve('https://login.tailscale.com/a/test'),
          enableHttps: () => ({ ok: true, secureUrl: 'https://test.example.ts.net' }),
        },
      }),
    });
    const pair = await app.request('/v1/onboarding/pair', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    expect(pair.status).toBe(200);
    const { token } = await pair.json() as { token: string };
    const headers = { [ONBOARDING_TOKEN_HEADER]: token, 'content-type': 'application/json' };
    expect((await app.request('/v1/onboarding/state', { headers })).status).toBe(200);
    const login = await app.request('/v1/onboarding/tailscale/connect', { method: 'POST', headers });
    expect(login.status).toBe(200);
    expect(await login.json()).toMatchObject({ loginUrl: 'https://login.tailscale.com/a/test' });
    const secure = await app.request('/v1/onboarding/tailscale/https', {
      method: 'POST', headers, body: JSON.stringify({ acceptCertificateTransparency: true }),
    });
    expect(secure.status).toBe(200);
    expect(await secure.json()).toMatchObject({ phase: 'secure' });
    expect((await app.request('/v1/onboarding/tailscale/connect', { method: 'POST' })).status).toBe(401);
  });

  it('mounts only setup metadata and onboarding, never credentials or product APIs', async () => {
    const app = createBootstrapApp({
      webDist: WEB_DIST,
      onboarding: new ServerOnboardingService({
        repo: new Repo(),
        clock: new FakeClock(),
        tailscale: {
          status: () => ({ installed: true, connected: false, serve: 'none' }),
          verifyHttps: () => Promise.resolve(true),
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
