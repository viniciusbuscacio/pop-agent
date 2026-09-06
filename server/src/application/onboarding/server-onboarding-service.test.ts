import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../testing/app-fixture.js';
import {
  createServerOnboarding,
} from '../../infrastructure/onboarding/onboarding-state-file.js';
import type {
  ServerOnboardingRecord,
  ServerOnboardingRepo,
  TailnetStatus,
  TailscaleGateway,
} from '../ports/server-onboarding.js';
import { ServerOnboardingService } from './server-onboarding-service.js';

class MemoryRepo implements ServerOnboardingRepo {
  record: ServerOnboardingRecord | undefined;
  read() { return this.record; }
  write(record: ServerOnboardingRecord) { this.record = structuredClone(record); }
  remove() { this.record = undefined; }
}

class FakeTailscale implements TailscaleGateway {
  current: TailnetStatus = { installed: true, connected: false, serve: 'none' };
  loginUrl = 'https://login.tailscale.com/a/abc123';
  ready = true;
  verifyHttps() { return Promise.resolve(this.ready); }
  status() { return this.current; }
  beginLogin() { return Promise.resolve(this.loginUrl); }
  enableHttps() {
    this.current = {
      installed: true,
      connected: true,
      dnsName: 'pop.example.ts.net.',
      serve: 'ours',
    };
    return { ok: true as const, secureUrl: 'https://pop.example.ts.net' };
  }
}

function fixture() {
  const clock = new FakeClock();
  const repo = new MemoryRepo();
  const generated = createServerOnboarding(repo, clock.now());
  const tailscale = new FakeTailscale();
  const service = new ServerOnboardingService({ repo, tailscale, clock });
  return { clock, repo, generated, tailscale, service };
}

describe('server network onboarding', () => {
  it('does not promote configured Serve or a failed readiness check to secure', async () => {
    const f = fixture(); const paired = f.service.pair(f.generated.code);
    if (!paired.ok) throw new Error('pairing failed');
    f.tailscale.current = { installed: true, connected: true, serve: 'ours', dnsName: 'pop.example.ts.net.' };
    expect(f.service.state(paired.token)?.phase).toBe('https');
    f.tailscale.ready = false;
    expect(await f.service.enableHttps(paired.token, true)).toEqual({ ok: false, reason: 'failed' });
    expect(f.service.allowsAccountSetup()).toBe(false);
    expect(f.repo.record?.phase).toBe('paired');
    f.tailscale.ready = true;
    expect(await f.service.enableHttps(paired.token, true)).toMatchObject({ ok: true, state: { phase: 'secure' } });
  });

  it('exchanges the terminal code once and protects detailed state with its token', () => {
    const f = fixture();
    expect(f.service.state('not-a-token')).toBeUndefined();
    const paired = f.service.pair(f.generated.code.toLowerCase());
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    expect(f.service.pair(f.generated.code)).toEqual({ ok: false, reason: 'not_required' });
    expect(f.service.state(paired.token)).toMatchObject({ phase: 'tailscale', tailscaleInstalled: true });
  });

  it('expires the code, locks repeated guesses, and can preserve an exchanged token past expiry', () => {
    const expired = fixture();
    expired.clock.advance(15 * 60_000 + 1);
    expect(expired.service.pair(expired.generated.code)).toEqual({ ok: false, reason: 'expired' });

    const locked = fixture();
    for (let attempt = 0; attempt < 5; attempt += 1) locked.service.pair('WRONG-CODE-0000');
    expect(locked.service.pair(locked.generated.code)).toEqual({ ok: false, reason: 'locked' });

    const paired = fixture();
    const result = paired.service.pair(paired.generated.code);
    if (!result.ok) throw new Error('pairing failed');
    paired.clock.advance(15 * 60_000 + 1);
    expect(paired.service.state(result.token)?.phase).toBe('tailscale');
  });

  it('never overwrites a conflicting Serve config and persists the verified HTTPS origin', async () => {
    const f = fixture();
    const paired = f.service.pair(f.generated.code);
    if (!paired.ok) throw new Error('pairing failed');
    f.tailscale.current = { installed: true, connected: true, serve: 'conflict' };
    expect(f.service.state(paired.token)).toMatchObject({ phase: 'blocked', issue: 'serve_conflict' });

    f.tailscale.current = { installed: true, connected: true, serve: 'none' };
    const secure = await f.service.enableHttps(paired.token, true, 'pop-agent');
    expect(secure).toMatchObject({ ok: true, state: { phase: 'secure', secureUrl: 'https://pop.example.ts.net' } });
    expect(f.repo.record?.phase).toBe('secure');
  });
});
