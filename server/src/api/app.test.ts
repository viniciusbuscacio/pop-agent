import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';

describe('app', () => {
  it('healthz responds ok without auth', async () => {
    const res = await createApp().request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('unknown routes return the structured error shape', async () => {
    const res = await createApp().request('/nope');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: 'not_found', status: 404 });
  });

  it('/v1/events is an SSE stream whose first event is a delta', async () => {
    const res = await createApp().request('/v1/events');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const { value } = await reader.read();
    await reader.cancel();
    const text = new TextDecoder().decode(value);
    const data = /data: (.*)/.exec(text)?.[1];
    expect(data, 'first SSE frame carries a data line').toBeDefined();
    expect(JSON.parse(data!)).toMatchObject({ kind: 'delta', runId: 'run-hello' });
  });
});
