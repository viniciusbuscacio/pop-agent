import Database from 'better-sqlite3';
import { describe, it, expect } from 'vitest';
import { migrate } from './migrate.js';
import { SqliteIntegrationRepo } from './sqlite-integration-repo.js';
describe('durable integration requests', () => {
    it('reuses a persisted response across service reconstruction and rejects mismatched payloads', () => {
        const db = new Database(':memory:');
        migrate(db);
        let calls = 0;
        const a = new SqliteIntegrationRepo(db);
        expect(a.once('token', 'key', 'hash', 100, () => ({ id: ++calls }))).toEqual({ id: 1 });
        const b = new SqliteIntegrationRepo(db);
        expect(b.once('token', 'key', 'hash', 101, () => ({ id: ++calls }))).toEqual({ id: 1 });
        expect(calls).toBe(1);
        expect(() => b.once('token', 'key', 'other', 101, () => ({}))).toThrow('idempotency_conflict');
        expect(b.once('token', 'key', 'new', 86400200, () => ({ id: ++calls }))).toEqual({ id: 2 });
        db.close();
    });
    it('never commits an idempotency success for a failed action', () => {
        const db = new Database(':memory:');
        migrate(db);
        const repo = new SqliteIntegrationRepo(db);
        expect(() => repo.once('t', 'k', 'h', 1, () => { throw new Error('failure'); })).toThrow('failure');
        expect(repo.once('t', 'k', 'h', 2, () => ({ ok: true }))).toEqual({ ok: true });
        db.close();
    });
});
