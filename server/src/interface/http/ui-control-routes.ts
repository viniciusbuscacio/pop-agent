import { restClientIp } from './rest-client-ip.js';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import type { UiBridgeService } from '../../application/integrations/ui-bridge-service.js';
import type { IntegrationService } from '../../application/integrations/integration-service.js';
import { IntegrationError } from '../../domain/integrations/integration.js';
import { apiError } from './errors.js';
const input = z.object({ sessionId: z.string().min(1).max(80), controlId: z.string().min(1).max(80).optional(), testid: z.string().min(1).max(200).optional(), index: z.number().int().min(0).max(1000).optional(), value: z.string().max(32000).optional(), key: z.string().min(1).max(80).optional(), deltaX: z.number().int().min(-100000).max(100000).optional(), deltaY: z.number().int().min(-100000).max(100000).optional() }).strict();
export const UI_ENDPOINTS = [
  { method: 'get', path: '/integration/ax', scope: 'ui:control', summary: 'Discover live UI control and screenshot instructions' },
  { method: 'get', path: '/integration/ui/sessions', scope: 'ui:control', summary: 'List available signed-in browser tabs' },
  ...(['state', 'screenshot'] as const).map(kind => ({ method: 'get' as const, path: '/integration/ui/' + kind, scope: 'ui:control' as const, summary: 'Read UI ' + kind + '; sessionId required' })),
  ...(['press', 'dblclick', 'key', 'input', 'scroll'] as const).map(kind => ({ method: 'post' as const, path: '/integration/ui/' + kind, scope: 'ui:control' as const, summary: 'Operate the connected tab: ' + kind + '; no automatic retries' })),
] as const;
export function createUiControlRoutes(bridge: UiBridgeService, integrations: IntegrationService): Hono {
  const app = new Hono();
  const descriptor = { schemaVersion: 2, app: 'Pop Agent', howToUse: 'Signed-in browser tabs connect automatically while REST API Server is enabled. Select its sessionId explicitly. Read state, then address any visible app control by its ephemeral controlId or by stable testid and index. Scroll the viewport or a visible container and read state again to reach controls outside the current view. Commands operate that real tab with owner authority. Screenshot requires browser screen-sharing consent. Never retry a timed-out write blindly. Native file pickers, OS dialogs and trusted keyboard shortcuts need the user.', axTree: { source: 'GET /v1/integration/ui/state?sessionId=...', addressing: 'Use controlId from the latest visible controls array, or stable testid plus index when repeated. controlId may change after rendering or navigation.' }, capabilities: ['ui.sessions', 'ui.state', 'ui.press', 'ui.dblclick', 'ui.input', 'ui.key', 'ui.scroll', 'ui.screenshot'], api: ['GET /v1/integration/ui/sessions', 'GET /v1/integration/ui/state?sessionId=...', 'POST /v1/integration/ui/press {sessionId,controlId}', 'POST /v1/integration/ui/input {sessionId,controlId,value:"..."}', 'POST /v1/integration/ui/key {sessionId,key:"Escape"}', 'POST /v1/integration/ui/scroll {sessionId,deltaY:600}', 'POST /v1/integration/ui/scroll {sessionId,controlId,deltaY:600}', 'POST /v1/integration/ui/dblclick {sessionId,controlId}', 'GET /v1/integration/ui/screenshot?sessionId=...'], authentication: 'Authorization: Bearer <integration token with ui:control>; owner sessions use /v1/ui/* instead.', errors: ['ui_not_connected', 'ui_busy', 'ui_timeout', 'unknown_control', 'unknown_testid', 'ambiguous_testid', 'disabled_control', 'unsupported_control', 'screen_not_shared'] };
  app.onError((error, c) => {
    if (error instanceof IntegrationError) return apiError(c, error.status, error.code, error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return apiError(c, 400, 'invalid_input', 'Invalid UI command.');
    return apiError(c, 503, 'ui_unavailable', 'UI bridge unavailable.');
  });
  for (const prefix of ['/ui', '/integration/ui']) {
    app.use(prefix + '/*', bodyLimit({ maxSize: 4 * 1024 * 1024, onError: c => apiError(c, 413, 'too_large', 'UI reply too large.') }));
    app.use(prefix + '/*', async (c, next) => {
      c.header('Cache-Control', 'no-store');
      const disconnect = prefix === '/ui' && c.req.method === 'DELETE' && /^\/v1\/ui\/sessions\/[^/]+$/u.test(c.req.path);
      if (!disconnect && !integrations.settings().serverEnabled) return apiError(c, 503, 'rest_api_server_disabled', 'REST API Server is disabled.');
      const secret = (c.req.header('Authorization') ?? '').replace(/^Bearer /u, '');
      if (prefix.startsWith('/integration')) { integrations.admit(secret); integrations.authorize(secret, 'ui:control'); }
      await next();
    });
    app.get(prefix + '/sessions', c => c.json({ sessions: bridge.list() }));
    for (const kind of ['state', 'screenshot', 'press', 'dblclick', 'key', 'input', 'scroll'] as const) {
      app.on(kind === 'state' || kind === 'screenshot' ? 'GET' : 'POST', prefix + '/' + kind, async c => {
        const body = input.parse(c.req.method === 'GET' ? { sessionId: c.req.query('sessionId') } : await c.req.json());
        if (body.controlId !== undefined && (body.testid !== undefined || body.index !== undefined)) return apiError(c, 400, 'invalid_input', 'Use controlId or testid and index, not both.');
        if (['press', 'dblclick', 'input'].includes(kind) && body.controlId === undefined && body.testid === undefined) return apiError(c, 400, 'missing_field', 'controlId or testid is required.');
        if (kind === 'input' && body.value === undefined || kind === 'key' && body.key === undefined) return apiError(c, 400, 'missing_field', 'Command value is required.');
        if (kind === 'scroll' && (body.deltaX ?? 0) === 0 && (body.deltaY ?? 0) === 0) return apiError(c, 400, 'missing_field', 'A non-zero deltaX or deltaY is required.');
        const { sessionId, ...command } = body;
        if (prefix.startsWith('/integration')) integrations.recordUiAccess((c.req.header('Authorization') ?? '').replace(/^Bearer /u, ''), kind, sessionId);
        const callerIp = restClientIp(c);
        const result = await bridge.dispatch(sessionId, { ...command, kind }, () => {
          integrations.assertAllowedIp(callerIp);
          if (!integrations.settings().serverEnabled) throw new IntegrationError(503, 'rest_api_server_disabled');
          if (prefix.startsWith('/integration')) integrations.authorize((c.req.header('Authorization') ?? '').replace(/^Bearer /u, ''), 'ui:control');
        });
        integrations.assertAllowedIp(callerIp);
        if (prefix.startsWith('/integration')) integrations.authorize((c.req.header('Authorization') ?? '').replace(/^Bearer /u, ''), 'ui:control');
        if (!integrations.settings().serverEnabled) return apiError(c, 503, 'rest_api_server_disabled', 'REST API Server is disabled.');
        const reply = result as { error?: { code: string; message: string }; png?: string };
        if (reply.error) return apiError(c, reply.error.code === 'ui_timeout' ? 503 : 409, reply.error.code, reply.error.message);
        if (kind === 'screenshot' && reply.png) {
          c.header('Content-Type', 'image/png'); return c.body(Buffer.from(reply.png, 'base64'));
        }
        return c.json(result);
      });
    }
  }
  app.get('/ax', c => c.json(descriptor));
  app.get('/integration/ax', c => { integrations.admit((c.req.header('Authorization') ?? '').replace(/^Bearer /u, '')); integrations.authorize((c.req.header('Authorization') ?? '').replace(/^Bearer /u, ''), 'ui:control'); return c.json(descriptor); });
  app.post('/ui/sessions', async c => { const { name } = z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(await c.req.json()); return c.json(bridge.register(name), 201); });
  const tabKey = (value: string | undefined): string => z.string().min(1).max(200).parse(value);
  app.get('/ui/sessions/:id/poll', c => c.json({ command: bridge.poll(c.req.param('id'), tabKey(c.req.header('X-Pop-UI-Key'))) }));
  app.post('/ui/sessions/:id/ack', async c => {
    const body = z.object({ commandId: z.string().max(80), reply: z.object({ state: z.unknown().optional(), png: z.string().max(3_500_000).regex(/^[A-Za-z0-9+/]*={0,2}$/u).optional(), error: z.object({ code: z.string().max(80), message: z.string().max(300) }).strict().optional() }).strict() }).strict().parse(await c.req.json());
    bridge.acknowledge(c.req.param('id'), tabKey(c.req.header('X-Pop-UI-Key')), body.commandId, body.reply); return c.json({ ok: true });
  });
  app.delete('/ui/sessions/:id', c => { bridge.remove(c.req.param('id'), tabKey(c.req.header('X-Pop-UI-Key'))); return c.json({ ok: true }); });
  return app;
}
