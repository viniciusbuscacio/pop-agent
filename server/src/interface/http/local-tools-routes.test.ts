import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createTestApp, type TestApp } from '../../testing/app-fixture.js';

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

  it('delivers a call by sequence and settles an idempotent event result', async () => {
    const connected = await attach();
    const id = ((await connected.json()) as { connectionId: string }).connectionId;
    const result = fixture.localConnections.call(id, { tool: 'read', input: { path: '/tmp/a' } }, () => undefined);

    const polled = await request(`/v1/local-tools/connections/${id}/poll`, 'POST', { ackSeq: 0 });
    const body = (await polled.json()) as {
      frames: { seq: number; frame: { kind: string; callId: string } }[];
    };
    expect(body.frames).toHaveLength(1);
    expect(body.frames[0]?.frame.kind).toBe('call');
    const callId = body.frames[0]?.frame.callId ?? '';

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

  it('removes the selected connection on delete', async () => {
    const connected = await attach();
    const id = ((await connected.json()) as { connectionId: string }).connectionId;
    expect(fixture.localConnections.connection(id)?.id).toBe(id);
    expect((await request(`/v1/local-tools/connections/${id}`, 'DELETE')).status).toBe(204);
    expect(fixture.localConnections.connection(id)).toBeUndefined();
  });
});
