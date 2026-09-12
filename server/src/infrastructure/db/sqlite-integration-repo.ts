import type { IntegrationRepo } from '../../application/ports/integration-repo.js';
import { IntegrationError, type RestClient, type IntegrationActivity, type IntegrationEvent, type IntegrationToken } from '../../domain/integrations/integration.js';
import type { Db } from './types.js';
export class SqliteIntegrationRepo implements IntegrationRepo {
    constructor(private readonly db: Db) { }
    clients(): RestClient[] { return (this.db.prepare('SELECT metadata FROM rest_clients ORDER BY id').all() as {
        metadata: string;
    }[]).map(r => JSON.parse(r.metadata) as RestClient); }
    saveClient(client: RestClient): void { this.db.prepare('INSERT INTO rest_clients VALUES (?,?) ON CONFLICT(id) DO UPDATE SET metadata=excluded.metadata').run(client.id, JSON.stringify(client)); }
    deleteClient(id: string): void { this.db.prepare('DELETE FROM rest_clients WHERE id=?').run(id); }
    tokens(): IntegrationToken[] { return (this.db.prepare('SELECT metadata FROM integration_tokens ORDER BY rowid DESC').all() as {
        metadata: string;
    }[]).map(r => JSON.parse(r.metadata) as IntegrationToken); }
    token(hash: string): IntegrationToken | undefined { const row = this.db.prepare('SELECT metadata FROM integration_tokens WHERE hash = ?').get(hash) as {
        metadata: string;
    } | undefined; return row === undefined ? undefined : JSON.parse(row.metadata) as IntegrationToken; }
    saveToken(token: IntegrationToken, hash: string): void { this.db.prepare('INSERT INTO integration_tokens VALUES (?, ?, ?)').run(token.id, hash, JSON.stringify(token)); }
    replaceToken(token: IntegrationToken, hash: string, persistSecret: () => void): void {
        this.db.transaction(() => {
            for (const previous of this.tokens()) {
                if (previous.revokedAt === null) this.revoke(previous.id, token.createdAt);
            }
            this.saveToken(token, hash);
            persistSecret();
            this.audit(token.id, 'rotate-key', '', token.createdAt);
        })();
    }
    private update(id: string, change: Partial<IntegrationToken>): void {
        const row = this.db.prepare('SELECT metadata FROM integration_tokens WHERE id = ?').get(id) as {
            metadata: string;
        } | undefined;
        if (row !== undefined)
            this.db.prepare('UPDATE integration_tokens SET metadata = ? WHERE id = ?').run(JSON.stringify({ ...JSON.parse(row.metadata) as IntegrationToken, ...change }), id);
    }
    revoke(id: string, now: number): void { this.update(id, { revokedAt: now }); }
    used(id: string, now: number): void { this.update(id, { lastUsedAt: now }); }
    once(tokenId: string, key: string, hash: string, now: number, action: () => Record<string, unknown>): Record<string, unknown> {
        return this.db.transaction(() => {
            this.db.prepare('DELETE FROM integration_requests WHERE created_at < ?').run(now - 86400000);
            const row = this.db.prepare('SELECT payload_hash, response FROM integration_requests WHERE token_id = ? AND request_key = ?').get(tokenId, key) as {
                payload_hash: string;
                response: string;
            } | undefined;
            if (row !== undefined) {
                if (row.payload_hash !== hash)
                    throw new IntegrationError(409, 'idempotency_conflict');
                return JSON.parse(row.response) as Record<string, unknown>;
            }
            const result = action();
            this.db.prepare('INSERT INTO integration_requests VALUES (?, ?, ?, ?, ?)').run(tokenId, key, hash, JSON.stringify(result), now);
            return result;
        })();
    }
    activity(id: string): IntegrationActivity | undefined { const row = this.db.prepare('SELECT snapshot FROM integration_activity WHERE run_id = ?').get(id) as {
        snapshot: string;
    } | undefined; return row === undefined ? undefined : JSON.parse(row.snapshot) as IntegrationActivity; }
    activities(offset: number, limit: number): IntegrationActivity[] { return (this.db.prepare('SELECT snapshot FROM integration_activity ORDER BY updated_at DESC, run_id LIMIT ? OFFSET ?').all(limit, offset) as {
        snapshot: string;
    }[]).map(r => JSON.parse(r.snapshot) as IntegrationActivity); }
    observe(activity: IntegrationActivity): void {
        const snapshot = JSON.stringify(activity);
        this.db.transaction(() => {
            this.db.prepare('INSERT INTO integration_activity VALUES (?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET snapshot=excluded.snapshot, updated_at=excluded.updated_at').run(activity.runId, snapshot, activity.updatedAt);
            this.db.prepare('INSERT INTO integration_events(snapshot, created_at) VALUES (?, ?)').run(snapshot, activity.updatedAt);
            this.db.prepare('DELETE FROM integration_events WHERE cursor <= (SELECT MAX(cursor)-1000 FROM integration_events)').run();
        })();
    }
    events(after: number): IntegrationEvent[] { return (this.db.prepare('SELECT cursor, snapshot FROM integration_events WHERE cursor > ? ORDER BY cursor LIMIT 1000').all(after) as {
        cursor: number;
        snapshot: string;
    }[]).map(r => ({ cursor: r.cursor, activity: JSON.parse(r.snapshot) as IntegrationActivity })); }
    cursorRange(): {
        oldest: number;
        latest: number;
    } { return this.db.prepare('SELECT COALESCE(MIN(cursor),0) AS oldest, COALESCE(MAX(cursor),0) AS latest FROM integration_events').get() as {
        oldest: number;
        latest: number;
    }; }
    audit(tokenId: string, operation: string, target: string, now: number): void { this.db.prepare('INSERT INTO integration_audit(token_id,operation,target,created_at) VALUES (?,?,?,?)').run(tokenId, operation, target, now); }
    prune(now: number): void {
        this.db.prepare('DELETE FROM integration_activity WHERE updated_at < ? OR run_id IN (SELECT run_id FROM integration_activity ORDER BY updated_at DESC LIMIT -1 OFFSET 10000)').run(now - 30 * 86400000);
        this.db.prepare('DELETE FROM integration_events WHERE created_at < ?').run(now - 3600000);
        this.db.prepare('DELETE FROM integration_audit WHERE created_at < ? OR id <= (SELECT MAX(id)-10000 FROM integration_audit)').run(now - 30 * 86400000);
        this.db.prepare('DELETE FROM integration_requests WHERE created_at < ?').run(now - 86400000);
    }
}
