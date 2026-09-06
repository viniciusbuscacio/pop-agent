import type { RestApiSettingsService, RestApiSettings } from './rest-api-settings.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { INTEGRATION_SCOPES, IntegrationError, type IntegrationActivity, type IntegrationScope, type IntegrationToken } from '../../domain/integrations/integration.js';
import type { IntegrationRepo } from '../ports/integration-repo.js';
import type { RunEvent } from '../ports/event-sink.js';
import type { ChatService } from '../chat/chat-service.js';
import type { RunService } from '../chat/run-service.js';
import type { QueuedMessageService } from '../chat/queued-message-service.js';
const digest = (text: string): string => createHash('sha256').update(text).digest('hex');
export class IntegrationService {
    private readonly limits = new Map<string, {
        start: number;
        count: number;
    }>();
    private readonly streams = new Map<string, number>();
    constructor(readonly repo: IntegrationRepo, private readonly deps: {
        chats: ChatService;
        runs: RunService;
        queue: QueuedMessageService;
        now: () => number;
        config: RestApiSettingsService;
    }) {
        for (const item of repo.activities(0, 10000)) {
            if ((item.state === 'running' || item.state === 'queued') && deps.runs.liveRun(item.chatId)?.runId !== item.runId) {
                repo.observe({ ...item, state: 'unknown', phase: 'unknown', updatedAt: deps.now() });
            }
        }
    }
    create(name: string, scopes: IntegrationScope[], days: number): {
        token: IntegrationToken;
        secret: string;
    } {
        if (!name.trim() || name.length > 80 || ![7, 30, 90].includes(days) || scopes.length === 0 || scopes.some(s => !INTEGRATION_SCOPES.includes(s)))
            throw new IntegrationError(400, 'invalid_token_options');
        if (this.repo.tokens().filter(token => token.revokedAt === null && token.expiresAt > this.deps.now()).length >= 100)
            throw new IntegrationError(409, 'token_limit');
        const now = this.deps.now();
        const token: IntegrationToken = { id: randomUUID(), name: name.trim(), scopes: [...new Set(scopes)], createdAt: now, expiresAt: now + days * 86400000, lastUsedAt: null, revokedAt: null };
        const secret = `popi_${randomBytes(32).toString('base64url')}`;
        this.repo.saveToken(token, digest(secret));
        this.repo.audit(token.id, 'create', '', now);
        return { token, secret };
    }
    revoke(id: string): void { this.repo.revoke(id, this.deps.now()); this.repo.audit(id, 'revoke', '', this.deps.now()); }
    settings(): RestApiSettings { return this.deps.config.get(); }
    configure(patch: Partial<RestApiSettings>): RestApiSettings { return this.deps.config.update(patch); }
    authenticate(secret: string): IntegrationToken {
        const token = secret.length <= 128 && secret.startsWith('popi_') ? this.repo.token(digest(secret)) : undefined;
        if (!token || token.revokedAt !== null || token.expiresAt <= this.deps.now())
            throw new IntegrationError(401, 'invalid_integration_token');
        return token;
    }
    authorize(secret: string, scope: IntegrationScope): IntegrationToken {
        if (!this.settings().serverEnabled) throw new IntegrationError(503, 'rest_api_server_disabled');
        const token = this.authenticate(secret);
        if (!token.scopes.includes(scope))
            throw new IntegrationError(403, 'missing_scope');
        return token;
    }
    admit(secret: string): void {
        if (!this.settings().serverEnabled) throw new IntegrationError(503, 'rest_api_server_disabled');
        const token = this.authenticate(secret);
        const now = this.deps.now();
        for (const [id, value] of this.limits)
            if (now - value.start >= 60000)
                this.limits.delete(id);
        const limit = this.limits.get(token.id) ?? { start: now, count: 0 };
        if (++limit.count > 120)
            throw new IntegrationError(429, 'rate_limited');
        this.limits.set(token.id, limit);
        if (token.lastUsedAt === null || now - token.lastUsedAt > 60000)
            this.repo.used(token.id, now);
        this.repo.prune(now);
    }
    openStream(secret: string): () => void {
        const token = this.authorize(secret, 'activity:read');
        const count = this.streams.get(token.id) ?? 0;
        if (count >= 3)
            throw new IntegrationError(429, 'stream_limit');
        this.streams.set(token.id, count + 1);
        let closed = false;
        return () => { if (closed)
            return; closed = true; const next = (this.streams.get(token.id) ?? 1) - 1; if (next === 0)
            this.streams.delete(token.id);
        else
            this.streams.set(token.id, next); };
    }
    mutate(secret: string, scope: IntegrationScope, key: string, operation: string, payload: Record<string, unknown>, action: () => Record<string, unknown>): Record<string, unknown> {
        const token = this.authorize(secret, scope);
        if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(key))
            throw new IntegrationError(400, 'idempotency_key_required');
        return this.repo.once(token.id, key, digest(JSON.stringify([operation, payload])), this.deps.now(), () => {
            const result = action();
            this.repo.audit(token.id, operation, String(payload['chatId'] ?? payload['runId'] ?? ''), this.deps.now());
            return result;
        });
    }
    createChat(): Record<string, unknown> { return { chatId: this.deps.chats.create().id }; }
    send(chatId: string, text: string): Record<string, unknown> {
        const chat = this.deps.chats.get(chatId);
        if (!chat)
            throw new IntegrationError(404, 'chat_not_found');
        if (chat.archived)
            throw new IntegrationError(409, 'chat_archived');
        const result = this.deps.runs.startRun(chatId, text, [], { client: { kind: 'api' }, executionMode: chat.executionMode ?? 'normal' });
        if (result.ok)
            return { chatId, runId: result.runId, userMessageId: result.userMessageId };
        if (result.reason === 'llm_stopped')
            throw new IntegrationError(503, 'llm_stopped');
        if (result.reason !== 'run_in_progress' && result.reason !== 'deployment_pending')
            throw new IntegrationError(409, result.reason);
        const queued = this.deps.queue.enqueue(chatId, { text, attachments: [], filePaths: [], deliveryMode: 'follow_up', executionMode: chat.executionMode ?? 'normal', client: { kind: 'api' } });
        if (!queued.ok)
            throw new IntegrationError(409, queued.reason);
        return { chatId, queued: true, queueId: queued.message.id };
    }
    cancel(runId: string): Record<string, unknown> {
        const snapshot = this.repo.activity(runId);
        if (!snapshot)
            throw new IntegrationError(404, 'run_not_found');
        const current = this.deps.runs.liveRun(snapshot.chatId);
        if (current?.runId === runId)
            this.deps.runs.stopRun(snapshot.chatId);
        return { runId, state: this.repo.activity(runId)?.state ?? 'unknown' };
    }
    cancelQueued(chatId: string, queueId: string): Record<string, unknown> {
        const result = this.deps.queue.cancel(chatId, queueId);
        if (!result.ok && result.reason !== 'queue_not_found')
            throw new IntegrationError(409, result.reason);
        return { chatId, queueId, removed: result.ok };
    }
    observe(event: RunEvent): void {
        if (!('runId' in event) || !event.runId)
            return;
        const previous = this.repo.activity(event.runId);
        const now = this.deps.now();
        const next: IntegrationActivity = { runId: event.runId, chatId: event.chatId, state: previous?.state ?? 'unknown', phase: previous?.phase ?? 'unknown', startedAt: previous?.startedAt ?? now, updatedAt: now, tool: previous?.tool ?? null, messageId: previous?.messageId ?? null, queueId: previous?.queueId ?? null };
        if (event.kind === 'run-started') {
            next.state = 'queued';
            next.phase = 'unknown';
            next.queueId = event.queuedMessageId ?? null;
        }
        else if (event.kind === 'run-status') {
            next.state = event.status;
            next.phase = event.status === 'running' ? 'model' : 'unknown';
        }
        else if (event.kind === 'tool') {
            next.tool = { name: event.name, status: event.status };
            next.phase = event.status === 'done' || event.status === 'error' ? 'model' : event.name === 'delegate_worker' ? 'subagent' : 'tool';
        }
        else if (event.kind === 'done') {
            next.state = 'completed';
            next.phase = 'finished';
            next.messageId = event.messageId;
        }
        else if (event.kind === 'error') {
            next.state = event.code === 'aborted' ? 'cancelled' : 'failed';
            next.phase = 'finished';
            next.messageId = event.message?.id ?? null;
        }
        else if (event.kind !== 'thinking' && event.kind !== 'delta')
            return;
        // Activity records never contain prompts, labels, tool arguments or outputs.
        this.repo.observe(next);
    }
}
