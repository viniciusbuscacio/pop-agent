import { afterEach, describe, expect, it, vi } from 'vitest';
import { githubCopilotOAuth } from '../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/oauth/github-copilot.js';

afterEach(() => vi.unstubAllGlobals());

function fixture(catalog: () => Response | never = () => Response.json({ data: [
  { id: 'gpt-5.6-sol', model_picker_enabled: true, policy: { state: 'enabled' } },
  { id: 'disabled', model_picker_enabled: true, policy: { state: 'disabled' } },
] }), tokenStatus = 200) {
  const controller = new AbortController();
  const requests: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push((init?.method ?? 'GET') + ' ' + url.pathname);
    if (url.pathname === '/login/device/code') return Response.json({
      device_code: 'fake-device', user_code: 'TEST-CODE', verification_uri: 'https://github.com/login/device',
      interval: 1, expires_in: 60,
    });
    if (url.pathname === '/login/oauth/access_token') return Response.json({ access_token: 'fake-refresh' });
    if (url.pathname === '/copilot_internal/v2/token') return tokenStatus === 200
      ? Response.json({ token: 'fake-access', expires_at: Math.floor(Date.now() / 1000) + 3600 })
      : new Response('token failure', { status: tokenStatus });
    if (url.pathname === '/models') return catalog();
    throw new Error('Unexpected request: ' + url.pathname);
  }));
  const login = () => githubCopilotOAuth.login({
    signal: controller.signal, prompt: async () => '', notify: () => undefined,
  });
  return { login, controller, requests };
}

describe('installed pi Copilot OAuth patch', () => {
  it('logs in with a read-only catalog and never accepts policies in bulk', async () => {
    const f = fixture();
    const credential = await f.login();
    expect(credential.availableModelIds).toEqual(['gpt-5.6-sol']);
    expect(f.requests).toEqual([
      'POST /login/device/code', 'POST /login/oauth/access_token',
      'GET /copilot_internal/v2/token', 'GET /models',
    ]);
  });
  it.each([429, 500, 503])('retains valid login credentials when only the catalog returns %s', async status => {
    const f = fixture(() => new Response('catalog failure', { status }));
    const credential = await f.login();
    expect(credential.access).toBe('fake-access');
    expect(credential.refresh).toBe('fake-refresh');
    expect(credential.availableModelIds).toBeUndefined();
    expect(f.requests.filter(p => p === 'GET /models')).toHaveLength(1);
  });
  it.each([401, 403])('does not hide catalog authentication failure %s', async status => {
    const f = fixture(() => new Response('denied', { status }));
    await expect(f.login()).rejects.toMatchObject({ status });
  });
  it('does not turn a token rate limit into a successful login', async () => {
    const f = fixture(undefined, 429);
    await expect(f.login()).rejects.toMatchObject({ status: 429 });
    expect(f.requests).not.toContain('GET /models');
  });
  it('preserves previous availability during a transient refresh failure', async () => {
    const f = fixture(() => new Response('', { status: 429 }));
    const result = await githubCopilotOAuth.refresh!({
      type: 'oauth', refresh: 'fake-refresh', access: 'old', expires: 0,
      availableModelIds: ['previous-model'],
    }, f.controller.signal);
    expect(result.access).toBe('fake-access');
    expect(result.availableModelIds).toEqual(['previous-model']);
    expect(f.requests).toEqual(['GET /copilot_internal/v2/token', 'GET /models']);
  });
  it('keeps credentials after catalog timeout without retrying', async () => {
    const f = fixture(() => { throw new DOMException('timed out', 'TimeoutError'); });
    await expect(f.login()).resolves.toMatchObject({ access: 'fake-access' });
    expect(f.requests.filter(p => p === 'GET /models')).toHaveLength(1);
  });
  it('never converts owner cancellation into success', async () => {
    const f = fixture(() => {
      f.controller.abort();
      throw new DOMException('cancelled', 'TimeoutError');
    });
    await expect(f.login()).rejects.toThrow('cancelled');
  });
  it('rejects malformed catalogs instead of pretending they are unavailable', async () => {
    const f = fixture(() => Response.json({ wrong: [] }));
    await expect(f.login()).rejects.toThrow('Invalid Copilot models response');
  });
});
