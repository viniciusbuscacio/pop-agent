import { expect, it } from 'vitest';
import { resolveRestClientIp } from './rest-client-ip.js';
import { createTestApp, setupTestSession } from '../../testing/app-fixture.js';
const headers = (token: string) => ({Authorization:'Bearer '+token,'content-type':'application/json'});
const env = (address: string) => ({incoming:{socket:{remoteAddress:address}}});
it('ignores spoofed forwarding from remote peers and trusts only the last local-proxy hop', () => {
  expect(resolveRestClientIp('192.0.2.1','100.90.1.1')).toBe('192.0.2.1');
  expect(resolveRestClientIp('::ffff:127.0.0.1','203.0.113.5, 100.90.1.1')).toBe('100.90.1.1');
  expect(resolveRestClientIp('::1','invalid')).toBeUndefined();
  expect(resolveRestClientIp(undefined,'100.90.1.1')).toBeUndefined();
});
it('enforces network policy on REST and UI operations while owner settings remain recoverable', async () => {
  const f=createTestApp(); const owner=await setupTestSession(f.app); const key=f.integrations.ensureAccessKey();
  const put = (entries:string[]) => f.app.request('/v1/rest-api/allowed-ips',{method:'PUT',headers:headers(owner),body:JSON.stringify({entries})});
  expect((await put(['100.64.0.0/10','fd7a:115c:a1e0::/48'])).status).toBe(200);
  const stored=await (await f.app.request('/v1/rest-api/allowed-ips',{headers:headers(owner)})).json();
  expect(stored).toEqual({entries:['100.64.0.0/10','fd7a:115c:a1e0::/48']});
  for(const path of ['/v1/integration/activity','/v1/integration/ax','/v1/integration/ui/sessions']) {
    expect((await f.app.request(path,{headers:headers(key)},env('100.90.1.1'))).status).toBe(200);
    expect((await f.app.request(path,{headers:{...headers(key),'x-forwarded-for':'100.90.1.1'}},env('192.0.2.1'))).status).toBe(403);
    expect((await f.app.request(path,{headers:{...headers(key),'x-forwarded-for':'100.90.1.1'}},env('127.0.0.1'))).status).toBe(200);
  }
  expect((await f.app.request('/v1/ax',{headers:headers(owner)},env('192.0.2.1'))).status).toBe(403);
  expect((await f.app.request('/v1/rest-api/key',{headers:headers(owner)},env('192.0.2.1'))).status).toBe(200);
  expect((await f.app.request('/v1/rest-api/allowed-ips',{headers:headers(key)},env('100.90.1.1'))).status).toBe(401);
  expect((await put([])).status).toBe(400); expect((await put(['bad'])).status).toBe(400);
  expect(await (await f.app.request('/v1/rest-api/allowed-ips',{headers:headers(owner)})).json()).toEqual(stored);
});
it('rechecks queued UI commands against an edited allowlist before delivery', async () => {
  const f=createTestApp(); const owner=await setupTestSession(f.app); const key=f.integrations.ensureAccessKey();
  const tab=await (await f.app.request('/v1/ui/sessions',{method:'POST',headers:headers(owner),body:JSON.stringify({name:'Tab'})})).json() as {id:string;key:string};
  f.integrations.setAllowedIps(['192.0.2.1']);
  const pending=f.app.request('/v1/integration/ui/press',{method:'POST',headers:headers(key),body:JSON.stringify({sessionId:tab.id,testid:'shell-new-chat'})},env('192.0.2.1'));
  await new Promise(resolve=>setTimeout(resolve,20));
  f.integrations.setAllowedIps(['100.64.0.0/10']);
  const poll=await f.app.request('/v1/ui/sessions/'+tab.id+'/poll',{headers:{...headers(owner),'X-Pop-UI-Key':tab.key}},env('192.0.2.1'));
  expect(await poll.json()).toEqual({command:null});
  expect((await pending).status).toBe(403);
});

it('closes an existing event stream after its address is removed', async () => {
  const f=createTestApp(); await setupTestSession(f.app); const key=f.integrations.ensureAccessKey();
  f.integrations.setAllowedIps(['192.0.2.1']);
  const response=await f.app.request('/v1/integration/events',{headers:headers(key)},env('192.0.2.1'));
  const reader=response.body!.getReader(); await reader.read();
  f.integrations.setAllowedIps(['100.64.0.0/10']);
  let done=false;
  for(let i=0;i<5;i++){ const result=await reader.read(); if(result.done){done=true;break;} }
  expect(done).toBe(true);
});

it('defaults to loopback only and does not treat a Tailscale-proxied remote caller as localhost', async () => {
  const f=createTestApp(); await setupTestSession(f.app); const key=f.integrations.ensureAccessKey();
  expect(f.integrations.allowedIps()).toEqual(['127.0.0.1/32']);
  expect((await f.app.request('/v1/integration/ax',{headers:headers(key)},env('127.0.0.1'))).status).toBe(200);
  expect((await f.app.request('/v1/integration/ax',{headers:{...headers(key),'x-forwarded-for':'100.90.1.1'}},env('127.0.0.1'))).status).toBe(403);
  expect((await f.app.request('/v1/integration/ax',{headers:headers(key)},env('::1'))).status).toBe(403);
});
