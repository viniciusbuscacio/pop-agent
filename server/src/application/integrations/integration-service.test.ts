import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { migrate } from '../../infrastructure/db/migrate.js';
import { SqliteIntegrationRepo } from '../../infrastructure/db/sqlite-integration-repo.js';
import { SqliteSecretsRepo } from '../../infrastructure/db/sqlite-secrets-repo.js';
import { RestApiSettingsService } from './rest-api-settings.js';
import { MemorySettings, MemorySecrets } from '../../testing/app-fixture.js';
import { it, expect, vi } from 'vitest';
import { IntegrationService } from './integration-service.js';
import type { IntegrationRepo } from '../ports/integration-repo.js';
import type { RunService } from '../chat/run-service.js';
import type { ChatService } from '../chat/chat-service.js';
import type { QueuedMessageService } from '../chat/queued-message-service.js';
it('never cancels a successor run when the requested run has already finished', () => {
    const stop = vi.fn();
    const repo = { activities: () => [], activity: () => ({ chatId: 'chat', runId: 'old', state: 'completed' }) } as unknown as IntegrationRepo;
    const runs = { liveRun: () => ({ runId: 'new' }), stopRun: stop } as unknown as RunService;
    const service = new IntegrationService(repo, { secrets: new MemorySecrets(), config: new RestApiSettingsService(new MemorySettings()), runs, chats: {} as ChatService, queue: {} as QueuedMessageService, now: () => 0 });
    expect(service.cancel('old')).toEqual({ runId: 'old', state: 'completed' });
    expect(stop).not.toHaveBeenCalled();
});

it('recovers the encrypted single key after rebuilding services and never stores its plaintext', () => {
    const db = new Database(':memory:');
    migrate(db);
    const encryptionKey = randomBytes(32);
    const make = () => new IntegrationService(new SqliteIntegrationRepo(db), {
        secrets: new SqliteSecretsRepo(db, encryptionKey), config: new RestApiSettingsService(new MemorySettings()),
        runs: {} as RunService, chats: {} as ChatService, queue: {} as QueuedMessageService, now: () => 100,
    });
    const first = make().ensureAccessKey();
    const reconstructed = make();
    expect(reconstructed.ensureAccessKey()).toBe(first);
    expect(reconstructed.repo.tokens().filter(t => t.revokedAt === null)).toHaveLength(1);
    expect(reconstructed.authenticate(first).expiresAt).toBe(8640000000000000);
    const row = db.prepare('SELECT value_encrypted FROM secrets WHERE key = ?').get('rest-api.access-key') as {value_encrypted: Buffer};
    expect(row.value_encrypted.includes(Buffer.from(first))).toBe(false);
    expect(JSON.stringify(db.prepare('SELECT * FROM integration_tokens').all())).not.toContain(first);
    expect(() => reconstructed.create('another', ['activity:read'], 7)).toThrow('single_api_key');
    db.close();
});
