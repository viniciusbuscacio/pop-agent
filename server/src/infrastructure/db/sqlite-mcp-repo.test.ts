import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from './migrate.js';
import { SqliteMcpRepo } from './sqlite-mcp-repo.js';

function server() {
  return {
    id: 'mcp-one', name: 'one', description: '', transport: 'streamable-http' as const,
    endpoint: 'https://example.test/mcp', command: '', args: [], authKind: 'none' as const,
    authHeader: '', enabled: true, timeoutMs: 60_000, status: 'connected' as const,
    lastError: '', protocolEra: 'modern' as const, protocolVersion: '2026-07-28', cwd: '/tmp',
    createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z',
  };
}

describe('sqlite MCP repository', () => {
  it('persists the negotiated protocol era and version', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrate(db);
    const repo = new SqliteMcpRepo(db);

    repo.create(server());

    expect(repo.get('mcp-one')).toMatchObject({
      protocolEra: 'modern',
      protocolVersion: '2026-07-28',
    });
    repo.update('mcp-one', { protocolEra: 'legacy', protocolVersion: '2025-03-26' });
    expect(repo.get('mcp-one')).toMatchObject({
      protocolEra: 'legacy',
      protocolVersion: '2025-03-26',
    });
    db.close();
  });
});
