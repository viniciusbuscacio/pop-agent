import { describe, expect, it } from 'vitest';
import { createTestApp } from '../../testing/app-fixture.js';

const PASSWORD = 'correct horse battery';

async function signedInApp() {
  const fixture = createTestApp();
  const res = await fixture.app.request('/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const { token } = (await res.json()) as { token: string };
  return { ...fixture, token };
}

describe('app', () => {
  it('healthz responds ok without auth', async () => {
    const res = await createTestApp().app.request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('serves the built frontend at the root', async () => {
    const res = await createTestApp().app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root">');
  });

  it('hands a deep link to the frontend instead of a 404', async () => {
    // /settings is a client-side route, not a file: the shell must answer so
    // the router can resolve it after hydration.
    const res = await createTestApp().app.request('/settings');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('serves the built assets', async () => {
    const shell = await (await createTestApp().app.request('/')).text();
    const asset = /src="(\/assets\/[^"]+\.js)"/.exec(shell)?.[1];
    expect(asset, 'index.html should reference a built bundle').toBeDefined();

    const res = await createTestApp().app.request(asset as string);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
  });

  it('unknown API routes return the structured error shape, not the shell', async () => {
    const { app, token } = await signedInApp();

    const res = await app.request('/v1/nope', { headers: { Authorization: `Bearer ${token}` } });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; status: number } };
    expect(body.error).toMatchObject({ code: 'not_found', status: 404 });
  });

  it('refuses to serve files from outside the build directory', async () => {
    const res = await createTestApp().app.request('/../../server/package.json');

    // Either the traversal is rejected outright or it falls through to the
    // shell; what must never happen is a file from outside web/dist.
    expect(res.headers.get('content-type')).not.toContain('application/json');
  });
});
