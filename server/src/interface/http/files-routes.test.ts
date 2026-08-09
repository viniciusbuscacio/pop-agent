import { describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../testing/app-fixture.js';

const PASSWORD = 'correct horse battery';

async function signedIn(): Promise<TestApp & { token: string }> {
  const fixture = createTestApp();
  const res = await fixture.app.request('/v1/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: PASSWORD }),
  });
  const { token } = (await res.json()) as { token: string };
  return { ...fixture, token };
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

function json(token: string): Record<string, string> {
  return { ...auth(token), 'content-type': 'application/json' };
}

describe('files routes', () => {
  it('serves the tree as the disk has it', async () => {
    const fixture = await signedIn();
    fixture.files.write('reports/pesca.pdf', Buffer.from('pdf'));
    fixture.files.write('root.txt', Buffer.from('txt'));

    const res = await fixture.app.request('/v1/files', { headers: auth(fixture.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tree: { path: string }[] };
    expect(body.tree.map((n) => n.path)).toEqual(['reports', 'root.txt']);
  });

  it('uploads into the open folder', async () => {
    const fixture = await signedIn();

    const form = new FormData();
    form.append('file', new File(['hello'], 'hello.txt', { type: 'text/plain' }));
    form.append('dir', 'inbox');
    const res = await fixture.app.request('/v1/files', {
      method: 'POST',
      headers: auth(fixture.token),
      body: form,
    });
    expect(res.status).toBe(201);
    expect(fixture.files.read('inbox/hello.txt')?.toString()).toBe('hello');
  });

  it('mints a signed link and serves the bytes only with a valid signature', async () => {
    const fixture = await signedIn();
    fixture.files.write('reports/pesca.pdf', Buffer.from('%PDF-fake'));

    const mint = await fixture.app.request('/v1/files/link', {
      method: 'POST',
      headers: json(fixture.token),
      body: JSON.stringify({ path: 'reports/pesca.pdf' }),
    });
    expect(mint.status).toBe(200);
    const { url } = (await mint.json()) as { url: string };

    const good = await fixture.app.request(url);
    expect(good.status).toBe(200);
    expect(await good.text()).toBe('%PDF-fake');
    expect(good.headers.get('content-type')).toBe('application/pdf');

    const forged = await fixture.app.request(url.replace('sig=', 'sig=X'));
    expect(forged.status).toBe(403);

    const noSig = await fixture.app.request('/files/download?path=reports%2Fpesca.pdf');
    expect(noSig.status).toBe(403);
  });

  it('refuses a link request whose path escapes the tree', async () => {
    const fixture = await signedIn();
    const res = await fixture.app.request('/v1/files/link', {
      method: 'POST',
      headers: json(fixture.token),
      body: JSON.stringify({ path: '../secret.key' }),
    });
    expect(res.status).toBe(400);
  });

  it('moves, refuses an occupied target, and deletes into the trash', async () => {
    const fixture = await signedIn();
    fixture.files.write('a.txt', Buffer.from('a'));
    fixture.files.write('b.txt', Buffer.from('b'));

    const moved = await fixture.app.request('/v1/files/move', {
      method: 'POST',
      headers: json(fixture.token),
      body: JSON.stringify({ from: 'a.txt', to: 'sub/a.txt' }),
    });
    expect(moved.status).toBe(204);

    const clash = await fixture.app.request('/v1/files/move', {
      method: 'POST',
      headers: json(fixture.token),
      body: JSON.stringify({ from: 'b.txt', to: 'sub/a.txt' }),
    });
    expect(clash.status).toBe(409);

    const deleted = await fixture.app.request('/v1/files?path=sub%2Fa.txt', {
      method: 'DELETE',
      headers: auth(fixture.token),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual(
      expect.objectContaining({ name: 'a.txt', originalPath: 'sub/a.txt', kind: 'file' }),
    );

    const trash = await fixture.app.request('/v1/trash', { headers: auth(fixture.token) });
    const { entries } = (await trash.json()) as {
      entries: { name: string; originalPath: string }[];
    };
    expect(entries).toEqual([
      expect.objectContaining({ name: 'a.txt', originalPath: 'sub/a.txt' }),
    ]);
  });

  it('restores from the trash to the original path', async () => {
    const fixture = await signedIn();
    fixture.files.write('keep/me.txt', Buffer.from('x'));
    fixture.files.remove('keep/me.txt');

    const res = await fixture.app.request('/v1/trash/me.txt/restore', {
      method: 'POST',
      headers: auth(fixture.token),
    });
    expect(res.status).toBe(204);
    expect(fixture.files.read('keep/me.txt')?.toString()).toBe('x');
  });

  it('searches names live', async () => {
    const fixture = await signedIn();
    fixture.files.write('reports/Pesca.pdf', Buffer.from('x'));

    const res = await fixture.app.request('/v1/files/search?q=pesca', {
      headers: auth(fixture.token),
    });
    const body = (await res.json()) as { hits: { path: string }[] };
    expect(body.hits.map((hit) => hit.path)).toEqual(['reports/Pesca.pdf']);
  });
});
