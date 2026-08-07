import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { SkillDTO, SkillsResponse } from '@popy/shared';
import { createTestApp, type TestApp } from '../../testing/app-fixture.js';

const PASSWORD = 'correct horse battery';
let fixture: TestApp;
let app: Hono;
let token: string;

beforeEach(async () => {
  fixture = createTestApp();
  app = fixture.app;
  const res = await app.request('/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  token = ((await res.json()) as { token: string }).token;
});

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  return Promise.resolve(
    app.request(path, {
      ...init,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    }),
  );
}

describe('/v1/skills', () => {
  it('needs a session', async () => {
    expect((await app.request('/v1/skills')).status).toBe(401);
  });

  it('lists the seeded skills including know-thyself', async () => {
    const body = (await (await authed('/v1/skills')).json()) as SkillsResponse;
    expect(body.skills.some((s) => s.slug === 'know-thyself' && s.source === 'builtin')).toBe(
      true,
    );
  });

  it('creates a user skill and lists it', async () => {
    const res = await authed('/v1/skills/my-skill', {
      method: 'PUT',
      body: JSON.stringify({
        slug: 'my-skill',
        name: 'My skill',
        description: 'd',
        whenToUse: 'w',
        body: 'b',
      }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).source).toBe('user');

    const list = (await (await authed('/v1/skills')).json()) as SkillsResponse;
    expect(list.skills.some((s) => s.slug === 'my-skill')).toBe(true);
  });

  it('refuses to delete a built-in skill', async () => {
    const res = await authed('/v1/skills/know-thyself', { method: 'DELETE' });
    expect(res.status).toBe(409);
  });

  it('deletes a user skill', async () => {
    await authed('/v1/skills/temp', {
      method: 'PUT',
      body: JSON.stringify({ slug: 'temp', name: 'T', description: '', whenToUse: '', body: 'x' }),
    });
    expect((await authed('/v1/skills/temp', { method: 'DELETE' })).status).toBe(204);
  });

  it('rejects a bad slug', async () => {
    const res = await authed('/v1/skills/Bad', {
      method: 'PUT',
      body: JSON.stringify({ slug: 'Bad Slug', name: 'x', description: '', whenToUse: '', body: 'y' }),
    });
    expect(res.status).toBe(400);
  });
  it('holds a pending skill out of the list until it is accepted', async () => {
    await authed('/v1/skills/learned', {
      method: 'PUT',
      body: JSON.stringify({
        slug: 'learned',
        name: 'Learned',
        description: 'd',
        whenToUse: 'w',
        body: 'b',
      }),
    });

    // The CRUD cannot create a pending skill (only the distiller does), so this
    // asserts the shape the screen reads: source and the absence of `pending`.
    const list = (await (await authed('/v1/skills')).json()) as SkillsResponse;
    const learned = list.skills.find((s) => s.slug === 'learned');
    expect(learned?.source).toBe('user');
    expect(learned?.pending).toBeUndefined();
  });

  it('404s when accepting a skill that does not exist', async () => {
    const res = await authed('/v1/skills/nope/approve', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('accepts a pending skill and returns it live', async () => {
    // Written straight through the vault, the way the agent's tool does it.
    fixture.skills.write({
      slug: 'from-a-chat',
      name: 'From a chat',
      description: 'd',
      whenToUse: 'w',
      body: 'b',
      source: 'auto',
      pending: true,
    });

    const res = await authed('/v1/skills/from-a-chat/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    const dto = (await res.json()) as SkillDTO;
    expect(dto.pending).toBeUndefined();
    expect(dto.source).toBe('auto');
  });
});
