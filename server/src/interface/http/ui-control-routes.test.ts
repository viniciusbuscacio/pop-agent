import { expect, it } from 'vitest';
import { createTestApp, setupTestSession } from '../../testing/app-fixture.js';
const headers = (token: string) => ({ Authorization: `Bearer ${token}`, 'content-type': 'application/json' });
it('requires owner authentication for registration and explicit UI scope for remote access', async () => {
  const f = createTestApp(); const owner = await setupTestSession(f.app);
  const observer = f.integrations.create('observer', ['activity:read'], 7);
  const operator = f.integrations.create('operator', ['ui:control'], 7);
  expect((await f.app.request('/v1/ui/sessions')).status).toBe(401);
  expect((await f.app.request('/v1/integration/ui/sessions', { headers: headers(observer.secret) })).status).toBe(403);
  expect((await f.app.request('/v1/ui/sessions', { method: 'POST', headers: headers(operator.secret), body: JSON.stringify({ name: 'Tab' }) })).status).toBe(401);
  const registered = await f.app.request('/v1/ui/sessions', { method: 'POST', headers: headers(owner), body: JSON.stringify({ name: 'Tab' }) });
  expect(registered.status).toBe(201); const tab = await registered.json() as { id: string; key: string };
  const list = await f.app.request('/v1/integration/ui/sessions', { headers: headers(operator.secret) });
  expect(list.status).toBe(200); expect(await list.text()).not.toContain(tab.key);
  expect((await f.app.request('/v1/ui/sessions/' + tab.id + '/poll', { headers: { ...headers(owner), 'X-Pop-UI-Key': 'wrong' } })).status).toBe(404);
  f.integrations.configure({ serverEnabled: false });
  expect((await f.app.request('/v1/integration/ui/sessions', { headers: headers(operator.secret) })).status).toBe(503);
  expect((await f.app.request('/v1/ui/sessions/' + tab.id + '/poll', { headers: { ...headers(owner), 'X-Pop-UI-Key': tab.key } })).status).toBe(503);
});
