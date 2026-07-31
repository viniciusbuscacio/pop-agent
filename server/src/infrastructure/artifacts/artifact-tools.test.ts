import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { FakeClock } from '../../testing/app-fixture.js';
import { migrate } from '../db/migrate.js';
import { SqliteArtifactRepo } from '../db/sqlite-artifact-repo.js';
import { ArtifactService } from '../../application/artifacts/artifact-service.js';
import { FsArtifactStore } from './artifact-store.js';
import { buildArtifactTools, resolveInWorkspace } from './artifact-tools.js';

/** A defineTool stub that just returns the definition, as the SDK's does. */
const defineTool = (tool: ToolDefinition): ToolDefinition => tool;

async function runSave(
  tool: ToolDefinition,
  params: { path: string; name?: string },
): Promise<string> {
  const execute = tool.execute as unknown as (
    id: string,
    params: unknown,
  ) => Promise<{ content: { type: string; text?: string }[] }>;
  const result = await execute('call-1', params);
  return result.content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('');
}

function firstTool(workspaceDir: string, chatId: string): ToolDefinition {
  const tool = buildArtifactTools(defineTool, artifacts, workspaceDir, chatId)[0];
  if (tool === undefined) throw new Error('buildArtifactTools returned no tool');
  return tool;
}

let workspace: string;
let store: string;
let db: Database.Database;
let artifacts: ArtifactService;

function seedChat(id: string): void {
  db.prepare(
    `INSERT INTO chats (id, title, model, archived, pi_session_id, summary, auto_title, created_at, updated_at)
     VALUES (?, '', '', 0, '', '', 0, '2026-07-31T09:00:00.000Z', '2026-07-31T09:00:00.000Z')`,
  ).run(id);
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'popy-ws-'));
  store = mkdtempSync(join(tmpdir(), 'popy-art-'));
  db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  migrate(db);
  seedChat('chat-1');
  artifacts = new ArtifactService({
    repo: new SqliteArtifactRepo(db),
    store: new FsArtifactStore(store),
    secretKey: Buffer.from('k'.repeat(32)),
    clock: new FakeClock(),
  });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(store, { recursive: true, force: true });
});

describe('save_artifact tool', () => {
  it('promotes a workspace file into a tracked artifact', async () => {
    writeFileSync(join(workspace, 'report.md'), '# Report\n\nBody.\n');
    const save = firstTool(workspace, 'chat-1');

    const message = await runSave(save, { path: 'report.md' });

    const listed = artifacts.list('chat-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ name: 'report.md', mime: 'text/markdown', source: 'agent' });
    expect(message).toContain(listed[0]?.id ?? 'MISSING');
  });

  it('takes a display name and reads nested paths', async () => {
    mkdirSync(join(workspace, 'out'), { recursive: true });
    writeFileSync(join(workspace, 'out', 'data.json'), '{"ok":true}');
    const save = firstTool(workspace, 'chat-1');

    await runSave(save, { path: 'out/data.json', name: 'Results' });

    expect(artifacts.list('chat-1')[0]).toMatchObject({ name: 'Results', mime: 'application/json' });
  });

  it('refuses a path that escapes the workspace and creates nothing', async () => {
    const save = firstTool(workspace, 'chat-1');

    const message = await runSave(save, { path: '../secret.key' });

    expect(message.toLowerCase()).toContain('could not save');
    expect(artifacts.list('chat-1')).toHaveLength(0);
  });

  it('rejects absolute and traversal paths at the jail', () => {
    expect(() => resolveInWorkspace(workspace, '/etc/passwd')).toThrow();
    expect(() => resolveInWorkspace(workspace, '../../etc/passwd')).toThrow();
    expect(resolveInWorkspace(workspace, 'a/b.txt')).toContain('a');
  });
});
