import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { A2aAgent } from '../../application/ports/a2a-repo.js';
import { migrate } from './migrate.js';
import { SqliteA2aRepo } from './sqlite-a2a-repo.js';

const timestamp = '2026-08-18T00:00:00.000Z';

function agent(id = 'a2a-agent-one'): A2aAgent {
  return {
    id,
    name: 'Weather',
    description: 'Remote forecasts',
    baseUrl: 'https://agent.test/a2a',
    agentCardPath: '.well-known/agent-card.json',
    authKind: 'bearer',
    authHeader: '',
    entraTenantId: '',
    entraClientId: '',
    entraScope: '',
    enabled: true,
    timeoutMs: 10_000,
    status: 'unknown',
    lastError: '',
    protocolVersion: '',
    agentVersion: '',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return { db, repo: new SqliteA2aRepo(db) };
}

describe('sqlite A2A repository', () => {
  it('persists agent configuration and updates connection metadata', () => {
    const { db, repo } = setup();
    repo.create(agent());

    expect(repo.get('a2a-agent-one')).toEqual(agent());
    const updated = repo.update('a2a-agent-one', {
      status: 'connected',
      protocolVersion: '0.3.0',
      agentVersion: '1.2.3',
      lastConnectedAt: timestamp,
    });
    expect(updated).toMatchObject({
      status: 'connected', protocolVersion: '0.3.0', agentVersion: '1.2.3',
    });
    expect(repo.list()).toHaveLength(1);
    db.close();
  });

  it('persists Microsoft Entra metadata while encoding the expanded auth kind safely', () => {
    const { db, repo } = setup();
    const foundry = {
      ...agent('foundry'),
      agentCardPath: 'agentCard/v1.0',
      authKind: 'microsoft-entra' as const,
      entraTenantId: 'tenant-id',
      entraClientId: 'client-id',
      entraScope: 'https://ai.azure.com/.default',
    };
    repo.create(foundry);
    expect(repo.get('foundry')).toEqual(foundry);
    const row = db.prepare(
      'SELECT auth_kind, auth_provider FROM a2a_agents WHERE id = ?',
    ).get('foundry') as { auth_kind: string; auth_provider: string };
    expect(row).toEqual({ auth_kind: 'none', auth_provider: 'microsoft-entra' });
    db.close();
  });

  it('atomically replaces discovered interfaces and skills', () => {
    const { db, repo } = setup();
    repo.create(agent());
    repo.replaceDiscovery(
      'a2a-agent-one',
      [{
        id: 'interface-one',
        agentId: 'a2a-agent-one',
        url: 'https://agent.test/a2a',
        protocolBinding: 'JSONRPC',
        protocolVersion: '0.3.0',
        updatedAt: timestamp,
      }],
      [{
        id: 'skill-one',
        agentId: 'a2a-agent-one',
        remoteSkillId: 'weather',
        name: 'Weather',
        description: 'Forecasts',
        tags: ['weather'],
        examples: ['Weather in Rio'],
        inputModes: ['text/plain'],
        outputModes: ['text/plain'],
        updatedAt: timestamp,
      }],
    );

    expect(repo.interfaces('a2a-agent-one')).toMatchObject([
      { id: 'interface-one', protocolBinding: 'JSONRPC' },
    ]);
    expect(repo.skills('a2a-agent-one')).toMatchObject([
      { id: 'skill-one', remoteSkillId: 'weather', tags: ['weather'] },
    ]);

    repo.replaceDiscovery('a2a-agent-one', [], []);
    expect(repo.interfaces('a2a-agent-one')).toEqual([]);
    expect(repo.skills('a2a-agent-one')).toEqual([]);
    db.close();
  });

  it('persists mapped remote tasks and cascades all agent-owned records', () => {
    const { db, repo } = setup();
    repo.create(agent());
    repo.createTask({
      id: 'a2a-task-one',
      agentId: 'a2a-agent-one',
      remoteTaskId: 'remote-one',
      contextId: 'context-one',
      state: 'submitted',
      requestText: 'Forecast Rio',
      responseText: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    expect(repo.updateTask('a2a-task-one', {
      state: 'completed', responseText: 'Sunny',
    })).toMatchObject({ state: 'completed', responseText: 'Sunny' });
    expect(repo.listTasks('a2a-agent-one')).toHaveLength(1);

    expect(repo.delete('a2a-agent-one')).toBe(true);
    expect(repo.getTask('a2a-task-one')).toBeUndefined();
    db.close();
  });
});
