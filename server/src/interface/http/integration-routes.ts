import { integrationTokenDto, restClientDto, integrationActivityDto, integrationChatDto } from './integration-dto.js';
import { bodyLimit } from 'hono/body-limit';
import type { MessageDTO } from '@pop-agent/shared';
import type { RestClientService } from '../../application/integrations/rest-client-service.js';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import { IntegrationError, INTEGRATION_SCOPES, type IntegrationScope } from '../../domain/integrations/integration.js';
import type { IntegrationService } from '../../application/integrations/integration-service.js';
import type { ChatService } from '../../application/chat/chat-service.js';
import { apiError } from './errors.js';
const bearer = (c: Context): string => (c.req.header('Authorization') ?? '').replace(/^Bearer /u, '');
const page = z.coerce.number().int().min(0).max(100000).default(0);
const limit = z.coerce.number().int().min(1).max(100).default(50);
export const INTEGRATION_ENDPOINTS = [
    { method: 'get', path: '/integration/activity', scope: 'activity:read', summary: 'Page through run activity without conversation content' },
    { method: 'get', path: '/integration/runs/{id}', scope: 'activity:read', summary: 'Read one durable run snapshot' },
    { method: 'get', path: '/integration/events', scope: 'activity:read', summary: 'Stream activity snapshots; Last-Event-ID resumes bounded replay' },
    { method: 'get', path: '/integration/conversations', scope: 'conversations:read', summary: 'Page through conversations' },
    { method: 'get', path: '/integration/conversations/{id}/messages', scope: 'conversations:read', summary: 'Read conversation messages' },
    { method: 'post', path: '/integration/conversations', scope: 'conversations:write', summary: 'Create a conversation; Idempotency-Key required' },
    { method: 'post', path: '/integration/conversations/{id}/messages', scope: 'conversations:write', summary: 'Send text or enqueue a follow-up; Idempotency-Key required' },
    { method: 'post', path: '/integration/runs/{id}/cancel', scope: 'runs:cancel', summary: 'Cancel only the specified run; Idempotency-Key required' },
    { method: 'post', path: '/integration/conversations/{id}/queue/{queueId}/cancel', scope: 'runs:cancel', summary: 'Remove a queued message; Idempotency-Key required' },
] as const;
export function integrationOpenApi(): Record<string, unknown> {
    const paths: Record<string, unknown> = {};
    const string = {type:'string'};
    const number = {type:'integer'};
    const nullableString = {type:['string','null']};
    const object = (properties:Record<string,unknown>):Record<string,unknown> => ({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
    const array = (items:Record<string,unknown>):Record<string,unknown> => ({type:'array',items});
    const activity = object({runId:string,chatId:string,state:{enum:['queued','running','completed','failed','cancelled','unknown']},phase:{enum:['unknown','model','tool','subagent','finished']},updatedAt:number,startedAt:number,tool:{anyOf:[{type:'null'},object({name:string,status:string})]},messageId:nullableString,queueId:nullableString});
    const chat = object({id:string,title:string,model:string,provider:string,archived:{type:'boolean'},pinned:{type:'boolean'},executionMode:{enum:['normal','plan']},createdAt:string,updatedAt:string,preview:string});
    const message = object({id:string,chatId:string,role:{enum:['user','assistant','system']},content:string,thinking:string,createdAt:string,tools:array(object({name:string,status:string,detail:string})),attachments:array(object({name:string,type:string,dataUri:string}))});
    const responseSchemas:Record<string,Record<string,unknown>> = {
      'get /integration/activity':object({runs:array(activity),oldest:number,latest:number}),
      'get /integration/runs/{id}':object({run:activity}),
      'get /integration/conversations':object({conversations:array(chat)}),
      'get /integration/conversations/{id}/messages':object({messages:array(message)}),
      'post /integration/conversations':object({chatId:string}),
      'post /integration/conversations/{id}/messages':{oneOf:[object({chatId:string,runId:string,userMessageId:string}),object({chatId:string,queued:{const:true},queueId:string})]},
      'post /integration/runs/{id}/cancel':object({runId:string,state:{enum:['queued','running','completed','failed','cancelled','unknown']}}),
      'post /integration/conversations/{id}/queue/{queueId}/cancel':object({chatId:string,queueId:string,removed:{type:'boolean'}}),
    };
    for (const e of INTEGRATION_ENDPOINTS) {
        const parameters: Record<string, unknown>[] = [...e.path.matchAll(/\{(\w+)\}/gu)].map(m => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
        if (e.method === 'post')
            parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', maxLength: 128 } });
        if (e.path === '/integration/events')
            parameters.push({ name: 'Last-Event-ID', in: 'header', schema: { type: 'integer', minimum: 0 } });
        if (e.path === '/integration/activity' || e.path === '/integration/conversations')
            parameters.push({ name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } }, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 } });
        if(e.path==='/integration/conversations' && e.method==='get')parameters.push({name:'archived',in:'query',schema:{type:'boolean',default:false}});
        if(e.path==='/integration/conversations/{id}/messages' && e.method==='get')parameters.push({name:'before',in:'query',schema:{type:'string'}},{name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:100,default:50}});
        const operation = { summary: e.summary, security: [{ integrationBearer: [] }], 'x-required-scope': e.scope, parameters,
            ...(e.path === '/integration/conversations/{id}/messages' && e.method === 'post' ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['text'], additionalProperties: false, properties: { text: { type: 'string', minLength: 1, maxLength: 32000 } } } } } } } : {}),
            responses: { '200': { description: 'Successful query or command' }, '202': { description: 'Work admitted' }, '400': { description: 'Invalid input' }, '401': { description: 'Invalid or expired token' }, '403': { description: 'Missing scope' }, '404': { description: 'Unknown resource' }, '409': { description: 'State or idempotency conflict' }, '429': { description: 'Rate or stream limit; Retry-After: 60' } } };
        const schema = e.path === '/integration/events' ? {type:'string'} : responseSchemas[`${e.method} ${e.path}`];
        const media = e.path === '/integration/events' ? 'text/event-stream' : 'application/json';
        const success = e.method === 'post' && !e.path.endsWith('/cancel') ? '202' : '200';
        const documented = { ...operation, responses: { [success]: { description: e.summary, content: { [media]: { schema } } }, ...Object.fromEntries(['400', '401', '403', '404', '409', '429', '503'].map(code => [code, { description: code === '429' ? 'Rate limit; Retry-After: 60' : 'Request rejected', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }])) } };
        paths[e.path] = { ...(paths[e.path] as object ?? {}), [e.method]: documented };
    }
    return { openapi: '3.1.0', info: { title: 'Pop Agent integration API', version: '1' }, servers: [{ url: '/v1' }], components: { schemas: { Error: { type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message', 'status'], properties: { code: { type: 'string' }, message: { type: 'string' }, status: { type: 'integer' } } } } } }, securitySchemes: { integrationBearer: { type: 'http', scheme: 'bearer' } } }, paths };
}
export function createIntegrationRoutes(service: IntegrationService, chats: ChatService, clients?: RestClientService): Hono {
    const app = new Hono();
    app.onError((error, c) => {
        if (error instanceof IntegrationError) {
            if (error.status === 429)
                c.header('Retry-After', '60');
            return apiError(c, error.status, error.code, error.message);
        }
        if (error instanceof z.ZodError || error instanceof SyntaxError)
            return apiError(c, 400, 'invalid_input', 'Invalid request input.');
        return apiError(c, 503, 'integration_unavailable', 'The integration request could not be completed.');
    });
    app.use('/integration/*', bodyLimit({maxSize:256*1024,onError:c=>apiError(c,413,'too_large','Integration request exceeds 256 KiB.')}));
    app.use('/rest-api/*', bodyLimit({maxSize:256*1024,onError:c=>apiError(c,413,'too_large','REST configuration request exceeds 256 KiB.')}));
    app.use('/integration/*', async (c, next) => { service.admit(bearer(c)); await next(); });
    const requireScope = (c: Context, scope: IntegrationScope): void => { service.authorize(bearer(c), scope); };
    if (clients) {
        const operation = z.object({ id: z.string().min(1).max(64), name: z.string().min(1).max(100), method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']), path: z.string().min(1).max(2048) }).strict();
        const client = z.object({ name: z.string().min(1).max(80), baseUrl: z.string().max(2048), enabled: z.boolean(), authHeader: z.string().max(80), operations: z.array(operation).min(1).max(30), credential: z.string().max(4096).optional() }).strict();
        app.get('/rest-api/clients', c => c.json({ clients: clients.list().map(restClientDto) }));
        app.post('/rest-api/clients', async (c) => { const { credential, ...input } = client.parse(await c.req.json()); return c.json({ client: restClientDto(clients.save(input, undefined, credential)) }, 201); });
        app.put('/rest-api/clients/:id', async (c) => { const { credential, ...input } = client.parse(await c.req.json()); return c.json({ client: restClientDto(clients.save(input, c.req.param('id'), credential)) }); });
        app.delete('/rest-api/clients/:id', c => { clients.delete(c.req.param('id')); return c.json({ ok: true }); });
        app.post('/rest-api/clients/:id/call', async (c) => { const input = z.object({ operationId: z.string().max(64), query: z.record(z.string(), z.string()).optional(), body: z.unknown().optional() }).strict().parse(await c.req.json()); return c.json(await clients.call(c.req.param('id'), input.operationId, input.query, input.body, c.req.raw.signal)); });
    }
    app.get('/rest-api/tokens', c => c.json({ tokens: service.repo.tokens().map(integrationTokenDto) }));
    app.post('/rest-api/tokens', async (c) => {
        const input = z.object({ name: z.string().min(1).max(80), scopes: z.array(z.enum(INTEGRATION_SCOPES)).min(1).max(4), days: z.union([z.literal(7), z.literal(30), z.literal(90)]).default(30) }).strict().parse(await c.req.json());
        c.header('Cache-Control', 'no-store');
        const created = service.create(input.name, input.scopes, input.days);
        return c.json({token:integrationTokenDto(created.token),secret:created.secret},201);
    });
    app.delete('/rest-api/tokens/:id', c => { service.revoke(c.req.param('id')); return c.json({ ok: true }); });
    app.get('/rest-api/reference', c => c.json({ endpoints: INTEGRATION_ENDPOINTS, openapi: integrationOpenApi() }));
    app.get('/rest-api/health', c => c.json({ ok: true }));
    app.get('/integration/activity', c => { requireScope(c, 'activity:read'); return c.json({ runs: service.repo.activities(page.parse(c.req.query('offset')), limit.parse(c.req.query('limit'))).map(integrationActivityDto), ...service.repo.cursorRange() }); });
    app.get('/integration/runs/:id', c => { requireScope(c, 'activity:read'); const run = service.repo.activity(c.req.param('id')); if (!run)
        throw new IntegrationError(404, 'run_not_found'); return c.json({ run: integrationActivityDto(run) }); });
    app.get('/integration/conversations', c => { requireScope(c, 'conversations:read'); const offset = page.parse(c.req.query('offset')); const size = limit.parse(c.req.query('limit')); return c.json({ conversations: chats.list({ archived: c.req.query('archived') === 'true' }).slice(offset, offset + size).map(integrationChatDto) }); });
    app.get('/integration/conversations/:id/messages', c => {
        requireScope(c, 'conversations:read');
        const id = c.req.param('id');
        if (!chats.get(id))
            throw new IntegrationError(404, 'chat_not_found');
        const messages = chats.getMessages(id, { limit: limit.parse(c.req.query('limit')), ...(c.req.query('before') ? { before: c.req.query('before')! } : {}) }) ?? [];
        return c.json({ messages: messages.map((message): MessageDTO => ({ id: message.id, chatId: message.chatId, role: message.role, content: message.content, thinking: message.thinking, tools: message.tools.map(tool => ({ name: tool.name, status: tool.status, detail: tool.detail })), attachments: message.attachments.map(file => ({ name: file.name, type: file.type, dataUri: file.dataUri })), createdAt: message.createdAt })) });
    });
    const mutate = (c: Context, scope: IntegrationScope, operation: string, payload: Record<string, unknown>, action: () => Record<string, unknown>) => service.mutate(bearer(c), scope, c.req.header('Idempotency-Key') ?? '', operation, payload, action);
    app.post('/integration/conversations', c => c.json(mutate(c, 'conversations:write', 'create', {}, () => service.createChat()), 202));
    app.post('/integration/conversations/:id/messages', async (c) => {
        requireScope(c, 'conversations:write');
        const input = z.object({ text: z.string().trim().min(1).max(32000) }).strict().parse(await c.req.json());
        const chatId = c.req.param('id');
        return c.json(mutate(c, 'conversations:write', 'send', { chatId, text: input.text }, () => service.send(chatId, input.text)), 202);
    });
    app.post('/integration/runs/:id/cancel', c => { const runId = c.req.param('id'); return c.json(mutate(c, 'runs:cancel', 'cancel', { runId }, () => service.cancel(runId))); });
    app.post('/integration/conversations/:id/queue/:queueId/cancel', c => { const chatId = c.req.param('id'); const queueId = c.req.param('queueId'); return c.json(mutate(c, 'runs:cancel', 'cancel-queue', { chatId, queueId }, () => service.cancelQueued(chatId, queueId))); });
    app.get('/integration/events', c => {
        const secret = bearer(c);
        requireScope(c, 'activity:read');
        const supplied = c.req.header('Last-Event-ID');
        let cursor = supplied === undefined ? service.repo.cursorRange().latest : z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).parse(supplied);
        const release = service.openStream(secret);
        c.header('Cache-Control', 'no-store');
        return streamSSE(c, async (stream) => {
            let ended = false;
            stream.onAbort(() => { ended = true; release(); });
            // Independently revoke even if a slow consumer has blocked a write.
            const lease = setInterval(() => { try {
                service.authorize(secret, 'activity:read');
            }
            catch {
                stream.abort();
            } }, 1000);
            lease.unref?.();
            try {
                await stream.writeSSE({ event: 'ready', data: JSON.stringify({ cursor, resync: supplied === undefined }) });
                while (!ended) {
                    try {
                        service.authorize(secret, 'activity:read');
                    }
                    catch {
                        await stream.writeSSE({ event: 'auth-expired', data: '{}' });
                        break;
                    }
                    const range = service.repo.cursorRange();
                    if (cursor > range.latest || (cursor < range.oldest - 1 && range.oldest !== 0)) {
                        cursor = range.latest;
                        await stream.writeSSE({ event: 'resync', data: JSON.stringify({ cursor }) });
                    }
                    else {
                        for (const event of service.repo.events(cursor)) {
                            await stream.writeSSE({ event: 'activity', id: String(event.cursor), data: JSON.stringify(integrationActivityDto(event.activity)) });
                            cursor = event.cursor;
                        }
                    }
                    await stream.writeSSE({ event: 'heartbeat', data: '{}' });
                    await stream.sleep(1000);
                }
            }
            finally {
                clearInterval(lease);
                release();
            }
        });
    });
    return app;
}
