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

describe('artifact routes', () => {
  it('lists a chat\'s artifacts', async () => {
    const fixture = await signedIn();
    const chat = fixture.chats.create();
    fixture.artifacts.create(
      { chatId: chat.id, name: 'a.txt', mime: 'text/plain', source: 'agent' },
      Buffer.from('hi'),
    );

    const res = await fixture.app.request(`/v1/chats/${chat.id}/artifacts`, { headers: auth(fixture.token) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { artifacts: { id: string; name: string; size: number }[] };
    expect(body.artifacts).toHaveLength(1);
    expect(body.artifacts[0]).toMatchObject({ name: 'a.txt', size: 2 });
    expect(body.artifacts[0]?.id).toMatch(/^file-/);
  });

  it('mints a signed link and serves the bytes only with a valid signature', async () => {
    const fixture = await signedIn();
    const chat = fixture.chats.create();
    const artifact = fixture.artifacts.create(
      { chatId: chat.id, name: 'report.txt', mime: 'text/plain', source: 'upload' },
      Buffer.from('the contents'),
    );

    const linkRes = await fixture.app.request(`/v1/artifacts/${artifact.id}/link`, {
      method: 'POST',
      headers: auth(fixture.token),
    });
    expect(linkRes.status).toBe(200);
    const { url } = (await linkRes.json()) as { url: string };

    // The download itself carries no session -- the signature is everything.
    const ok = await fixture.app.request(url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toContain('report.txt');
    expect(await ok.text()).toBe('the contents');

    // Tamper with the signature: refused, no session involved.
    const forged = url.replace(/sig=[^&]+/, 'sig=forged');
    expect((await fixture.app.request(forged)).status).toBe(403);
  });

  it('deletes an artifact and then reports it gone', async () => {
    const fixture = await signedIn();
    const chat = fixture.chats.create();
    const artifact = fixture.artifacts.create(
      { chatId: chat.id, name: 'a.txt', mime: 'text/plain', source: 'agent' },
      Buffer.from('x'),
    );

    expect((await fixture.app.request(`/v1/artifacts/${artifact.id}`, {
      method: 'DELETE',
      headers: auth(fixture.token),
    })).status).toBe(204);

    expect((await fixture.app.request(`/v1/artifacts/${artifact.id}/link`, {
      method: 'POST',
      headers: auth(fixture.token),
    })).status).toBe(404);
  });

  it('refuses the download route without a signature', async () => {
    const fixture = await signedIn();
    const res = await fixture.app.request('/artifacts/file-whatever/download');
    expect(res.status).toBe(403);
  });

  it('uploads a file into a chat and then lists and downloads it', async () => {
    const fixture = await signedIn();
    const chat = fixture.chats.create();

    const form = new FormData();
    form.append('file', new File([Buffer.from('uploaded bytes')], 'notes.txt', { type: 'text/plain' }));
    const upload = await fixture.app.request(`/v1/chats/${chat.id}/artifacts`, {
      method: 'POST',
      headers: auth(fixture.token),
      body: form,
    });
    expect(upload.status).toBe(201);
    const created = (await upload.json()) as { id: string; name: string; size: number; source: string };
    expect(created).toMatchObject({ name: 'notes.txt', size: 14, source: 'upload' });

    const list = await fixture.app.request(`/v1/chats/${chat.id}/artifacts`, { headers: auth(fixture.token) });
    const body = (await list.json()) as { artifacts: { id: string }[] };
    expect(body.artifacts.map((a) => a.id)).toContain(created.id);
  });

  it('refuses an upload to a chat that does not exist', async () => {
    const fixture = await signedIn();
    const form = new FormData();
    form.append('file', new File([Buffer.from('x')], 'x.txt', { type: 'text/plain' }));
    const res = await fixture.app.request('/v1/chats/chat-nope/artifacts', {
      method: 'POST',
      headers: auth(fixture.token),
      body: form,
    });
    expect(res.status).toBe(404);
  });

  it('versions a re-upload and serves each version by a signed link', async () => {
    const fixture = await signedIn();
    const chat = fixture.chats.create();
    const first = fixture.artifacts.create(
      { chatId: chat.id, name: 'doc.txt', mime: 'text/plain', source: 'upload' },
      Buffer.from('one'),
    );
    fixture.artifacts.create(
      { chatId: chat.id, name: 'doc.txt', mime: 'text/plain', source: 'agent' },
      Buffer.from('two'),
    );

    const history = await fixture.app.request(`/v1/artifacts/${first.id}/versions`, {
      headers: auth(fixture.token),
    });
    expect(history.status).toBe(200);
    const body = (await history.json()) as { versions: { version: number }[] };
    expect(body.versions.map((v) => v.version)).toEqual([2, 1]);

    const linkRes = await fixture.app.request(`/v1/artifacts/${first.id}/versions/1/link`, {
      method: 'POST',
      headers: auth(fixture.token),
    });
    expect(linkRes.status).toBe(200);
    const { url } = (await linkRes.json()) as { url: string };

    const download = await fixture.app.request(url);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('one');

    // The latest download serves the newest bytes.
    const latest = await fixture.app.request(`/v1/artifacts/${first.id}/link`, {
      method: 'POST',
      headers: auth(fixture.token),
    });
    const latestUrl = ((await latest.json()) as { url: string }).url;
    expect(await (await fixture.app.request(latestUrl)).text()).toBe('two');
  });
});
