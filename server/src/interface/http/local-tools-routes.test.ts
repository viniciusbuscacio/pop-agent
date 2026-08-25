import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createTestApp, type TestApp } from '../../testing/app-fixture.js';
import { PollConnection } from './local-tools-routes.js';

let fixture: TestApp;
let app: Hono;
let token: string;

beforeEach(async () => {
  fixture = createTestApp();
  app = fixture.app;
  const response = await app.request('/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'correct horse battery' }),
  });
  token = ((await response.json()) as { token: string }).token;
});

const request = (path: string, method: string, body?: unknown, authorization = token) =>
  app.request(path, {
    method,
    headers: {
      authorization: `Bearer ${authorization}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const attach = () =>
  request('/v1/local-tools/connections', 'POST', {
    kind: 'attach',
    protocol: 1,
    role: 'interactive',
    machine: {
      machineId: 'machine-test',
      hostname: 'test-mac',
      platform: 'darwin',
      arch: 'arm64',
      cwd: '/tmp',
      clientVersion: '99.0.0',
    },
  });

describe('HTTPS local-tools fallback', () => {
  it('uses the common bearer session on every endpoint', async () => {
    expect((await request('/v1/local-tools/connections', 'POST', {}, 'bad')).status).toBe(401);
    const connected = await attach();
    expect(connected.status).toBe(201);
    const id = ((await connected.json()) as { connectionId: string }).connectionId;
    expect((await request(`/v1/local-tools/connections/${id}/poll`, 'POST', {}, 'bad')).status).toBe(401);
    expect((await request(`/v1/local-tools/connections/${id}/events`, 'POST', { events: [] }, 'bad')).status).toBe(401);
    expect((await request(`/v1/local-tools/connections/${id}`, 'DELETE', undefined, 'bad')).status).toBe(401);
  });

  it('rejects unknown protocol revisions and oversized machine metadata', async () => {
    const base = {
      kind: 'attach', role: 'interactive',
      machine: {
        machineId: 'machine-test', hostname: 'test-mac', platform: 'darwin', arch: 'arm64',
        cwd: '/tmp', clientVersion: '99.0.0',
      },
    };
    expect((await request('/v1/local-tools/connections', 'POST', { ...base, protocol: 2 })).status).toBe(400);
    expect((await request('/v1/local-tools/connections', 'POST', {
      ...base, protocol: 1, machine: { ...base.machine, hostname: 'x'.repeat(256) },
    })).status).toBe(400);
    expect((await request('/v1/local-tools/connections', 'POST', {
      ...base, protocol: 1, machine: { ...base.machine, machineId: '__proto__' },
    })).status).toBe(400);

    const connected = await attach();
    const id = ((await connected.json()) as { connectionId: string }).connectionId;
    const oversizedEvent = await request(`/v1/local-tools/connections/${id}/events`, 'POST', {
      events: [{ eventId: 'x'.repeat(257), frame: { kind: 'pong' } }],
    });
    expect(await oversizedEvent.json()).toEqual({ acceptedEventIds: [] });
  });

  it('delivers a call by sequence and settles an idempotent event result', async () => {
    const connected = await attach();
    const id = ((await connected.json()) as { connectionId: string }).connectionId;
    expect((await request('/v1/local-tools/machines/machine-test', 'PATCH', { enabled: true })).status).toBe(200);
    const result = fixture.localConnections.call(id, { tool: 'read', input: { path: '/tmp/a' } }, () => undefined);

    const polled = await request(`/v1/local-tools/connections/${id}/poll`, 'POST', { ackSeq: 0 });
    const body = (await polled.json()) as {
      frames: { seq: number; frame: { kind: string; callId: string } }[];
    };
    const call = body.frames.find((frame) => frame.frame.kind === 'call');
    expect(call).toBeDefined();
    const callId = call?.frame.callId ?? '';

    const event = {
      events: [
        { eventId: 'event-result', frame: { kind: 'result', callId, ok: true, output: 'YQ==' } },
      ],
    };
    expect((await request(`/v1/local-tools/connections/${id}/events`, 'POST', event)).status).toBe(200);
    expect((await request(`/v1/local-tools/connections/${id}/events`, 'POST', event)).status).toBe(200);
    await expect(result).resolves.toMatchObject({ ok: true, output: 'YQ==' });
  });

  it('lists live machines so the PWA can select one explicitly', async () => {
    const connected = await attach();
    const id = ((await connected.json()) as { connectionId: string }).connectionId;
    const response = await request('/v1/local-tools/connections', 'GET');

    expect(await response.json()).toEqual({
      connections: [{
        id,
        role: 'interactive',
        machine: {
          machineId: 'machine-test', hostname: 'test-mac', platform: 'darwin', arch: 'arm64', clientVersion: '99.0.0',
        },
      }],
    });
  });

  it('deduplicates the machine menu when CLI and tray connect from the same computer', async () => {
    await attach();
    await request('/v1/local-tools/connections', 'POST', {
      kind: 'attach', protocol: 1, role: 'background',
      machine: {
        machineId: 'machine-test', hostname: 'test-mac', platform: 'darwin', arch: 'arm64',
        cwd: '/tmp', clientVersion: '99.0.0',
      },
    });

    const body = (await (await request('/v1/local-tools/machines', 'GET')).json()) as {
      machines: { machineId: string; connected: boolean }[];
    };
    expect(body.machines).toMatchObject([{ machineId: 'machine-test', connected: true }]);
  });

  it('does not show a macOS machine as PWA-online with only an interactive connection', async () => {
    const connected = await attach();
    const id = ((await connected.json()) as { connectionId: string }).connectionId;
    expect(await (await request('/v1/local-tools/machines', 'GET')).json()).toEqual({
      machines: [{
        machineId: 'machine-test', hostname: 'test-mac', platform: 'darwin', arch: 'arm64',
        clientVersion: '99.0.0', enabled: false, connected: false,
      }],
    });
    const trayChange = {
      events: [{ eventId: 'access-on', frame: { kind: 'set_access', enabled: true } }],
    };
    expect((await request(`/v1/local-tools/connections/${id}/events`, 'POST', trayChange)).status).toBe(200);
    expect(fixture.localAccessPolicy.enabled('machine-test')).toBe(true);
    expect((await request('/v1/local-tools/machines/machine-test', 'PATCH', { enabled: false })).status).toBe(200);
    expect(fixture.localAccessPolicy.enabled('machine-test')).toBe(false);
    expect((await request('/v1/local-tools/machines/missing', 'PATCH', { enabled: true })).status).toBe(404);
  });

  it('broadcasts computer changes over the shared SSE hub', async () => {
    const events: string[] = [];
    const unsubscribe = fixture.hub.subscribe((payload) => events.push(payload));
    const connected = await attach();
    const id = ((await connected.json()) as { connectionId: string }).connectionId;
    await request('/v1/local-tools/machines/machine-test', 'PATCH', { enabled: true });
    await request(`/v1/local-tools/connections/${id}`, 'DELETE');
    unsubscribe();

    expect(events.map((payload) => JSON.parse(payload))).toEqual([
      { kind: 'local-machines-changed' },
      { kind: 'local-machines-changed' },
      { kind: 'local-machines-changed' },
    ]);
  });

  it('bounds queued long-poll bytes and the event-id replay window', () => {
    const closed: string[] = [];
    const connection = new PollConnection(
      {
        kind: 'attach', protocol: 1, role: 'background',
        machine: {
          machineId: 'machine-test', hostname: 'test-mac', platform: 'darwin', arch: 'arm64',
          cwd: '/tmp', clientVersion: '99.0.0',
        },
      },
      { epoch: 1, iat: 0, exp: Number.MAX_SAFE_INTEGER },
      (id) => closed.push(id),
    );
    connection.send({ kind: 'output', chunk: 'a'.repeat(5 * 1024 * 1024) });
    connection.send({ kind: 'output', chunk: 'b'.repeat(5 * 1024 * 1024) });
    expect(connection.closed).toBe(false);
    connection.send({ kind: 'output', chunk: 'c'.repeat(3 * 1024 * 1024) });
    expect(connection.closed).toBe(true);
    expect(closed).toEqual([connection.id]);

    const replay = new PollConnection(connection.attach, connection.session);
    for (let id = 0; id < 4_097; id += 1) expect(replay.acceptEvent(`event-${String(id)}`)).toBe(true);
    expect(replay.acceptEvent('event-0')).toBe(true);
    expect(replay.acceptEvent('event-4096')).toBe(false);
  });

  it('removes the selected connection on delete', async () => {
    const connected = await attach();
    const id = ((await connected.json()) as { connectionId: string }).connectionId;
    expect(fixture.localConnections.transportConnection(id)?.id).toBe(id);
    expect((await request(`/v1/local-tools/connections/${id}`, 'DELETE')).status).toBe(204);
    expect(fixture.localConnections.transportConnection(id)).toBeUndefined();
  });
});
