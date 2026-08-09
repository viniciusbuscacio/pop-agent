import { beforeEach, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import type { SkillDTO, SkillsResponse } from '@pop-agent/shared';
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

  it('lists the seeded skills including pop-agent-manual', async () => {
    const body = (await (await authed('/v1/skills')).json()) as SkillsResponse;
    expect(body.skills.some((s) => s.slug === 'pop-agent-manual' && s.source === 'builtin')).toBe(
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
    const res = await authed('/v1/skills/pop-agent-manual', { method: 'DELETE' });
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

  describe('POST /v1/skills/:slug/enabled', () => {
    it('rejects a non-boolean enabled field with a schema error', async () => {
      const res = await authed('/v1/skills/shell-safety/enabled', {
        method: 'POST',
        body: JSON.stringify({ enabled: 'no' }),
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('missing_field');
    });

    it('disables a skill and returns the updated dto', async () => {
      const res = await authed('/v1/skills/shell-safety/enabled', {
        method: 'POST',
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as SkillDTO)).toMatchObject({
        slug: 'shell-safety',
        enabled: false,
      });
    });

    it('404s for an unknown slug', async () => {
      const res = await authed('/v1/skills/ghost/enabled', {
        method: 'POST',
        body: JSON.stringify({ enabled: false }),
      });
      expect(res.status).toBe(404);
    });
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

describe('the distiller queue on /v1/skills', () => {
  const REVISION = {
    slug: 'planted',
    name: 'A better planted',
    description: 'The rewritten description',
    whenToUse: 'rewritten',
    body: 'The rewritten procedure.',
    createdAt: '2026-08-07T20:00:00.000Z',
    similarity: 0.94,
  };

  function plant(): void {
    fixture.skills.write({
      slug: 'planted',
      name: 'Planted',
      description: 'The original description',
      whenToUse: 'original',
      body: 'The original procedure.',
      source: 'auto',
    });
  }

  it('shows a proposed rewrite beside the skill it would replace', async () => {
    plant();
    fixture.skillRevisions.save(REVISION);

    const body = (await (await authed('/v1/skills')).json()) as SkillsResponse;
    const skill = body.skills.find((entry) => entry.slug === 'planted');

    // The skill still says what it always said: the proposal is beside it,
    // never in it, which is the whole point of holding it out of the vault.
    expect(skill?.body).toBe('The original procedure.');
    expect(skill?.proposedRevision).toMatchObject({
      body: 'The rewritten procedure.',
      similarity: 0.94,
    });
  });

  it('applies a rewrite that was accepted', async () => {
    plant();
    fixture.skillRevisions.save(REVISION);

    const res = await authed('/v1/skills/planted/revision/approve', { method: 'POST' });
    expect(res.status).toBe(200);
    expect((await res.json() as SkillDTO).body).toBe('The rewritten procedure.');

    // Accepting is not editing: the skill stays `auto`, so the collector still
    // manages it. Only a human edit promotes one to `user`.
    expect(fixture.skills.get('planted')?.source).toBe('auto');
    expect(fixture.skillRevisions.get('planted')).toBeUndefined();
  });

  it('keeps the current version when the rewrite is declined', async () => {
    plant();
    fixture.skillRevisions.save(REVISION);

    expect((await authed('/v1/skills/planted/revision', { method: 'DELETE' })).status).toBe(204);
    expect(fixture.skills.get('planted')?.body).toBe('The original procedure.');
    expect(fixture.skillRevisions.get('planted')).toBeUndefined();
  });

  it('answers 404 for a rewrite nobody proposed', async () => {
    plant();
    expect((await authed('/v1/skills/planted/revision/approve', { method: 'POST' })).status).toBe(404);
    expect((await authed('/v1/skills/planted/revision', { method: 'DELETE' })).status).toBe(404);
  });

  it('drops a pending rewrite with the skill it belonged to', async () => {
    plant();
    fixture.skillRevisions.save(REVISION);

    expect((await authed('/v1/skills/planted', { method: 'DELETE' })).status).toBe(204);
    expect(fixture.skillRevisions.get('planted')).toBeUndefined();
  });

  it('lists what the collector archived, and brings one back', async () => {
    plant();
    fixture.skills.archive('planted');

    const listed = (await (await authed('/v1/skills')).json()) as SkillsResponse;
    expect(listed.archived.map((skill) => skill.slug)).toEqual(['planted']);
    expect(listed.skills.map((skill) => skill.slug)).not.toContain('planted');

    expect((await authed('/v1/skills/planted/restore', { method: 'POST' })).status).toBe(200);
    expect(fixture.skills.get('planted')).toBeDefined();
  });

  it('answers 404 restoring something that was never archived', async () => {
    expect((await authed('/v1/skills/ghost/restore', { method: 'POST' })).status).toBe(404);
  });

  it('reports what is waiting, and when it last looked', async () => {
    plant();
    fixture.skills.write({
      slug: 'waiting',
      name: 'Waiting',
      description: 'd',
      whenToUse: 'w',
      body: 'b',
      source: 'auto',
      pending: true,
    });
    fixture.skillRevisions.save(REVISION);
    fixture.distillation.set('chat-1', 'm1', '2026-08-07T20:00:00.000Z');

    const body = (await (await authed('/v1/skills')).json()) as SkillsResponse;
    expect(body.distiller).toEqual({
      enabled: true,
      lastRunAt: '2026-08-07T20:00:00.000Z',
      pending: 1,
      revisions: 1,
    });
  });

  it('says it has never looked before its first round', async () => {
    const body = (await (await authed('/v1/skills')).json()) as SkillsResponse;
    expect(body.distiller.lastRunAt).toBeUndefined();
    expect(body.distiller).toMatchObject({ enabled: true, pending: 0, revisions: 0 });
  });
});
