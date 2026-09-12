import { buildFileTools } from './file-tools.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from '../db/database.js';
import { SqliteAttachmentCatalogRepo } from '../db/sqlite-attachment-catalog-repo.js';
import { SqliteFileProvenanceRepo } from '../db/sqlite-file-provenance-repo.js';
import { FilesService } from '../../application/files/files-service.js';
import { FileProvenanceService } from '../../application/files/file-provenance.js';
import { AttachmentArchive } from '../../application/files/attachment-archive.js';

const root = mkdtempSync(join(tmpdir(), 'pop-attachment-test-'));
const db = openDatabase(':memory:');
const files = new FilesService({ root, clock: { now: () => Date.now() } });
const provenance = new FileProvenanceService({ files, repo: new SqliteFileProvenanceRepo(db), clock: { now: () => Date.now() } });
const archive = new AttachmentArchive({ files, repo: new SqliteAttachmentCatalogRepo(db), provenance });
afterEach(() => { db.exec('DELETE FROM attachment_catalog'); });
import { afterAll } from 'vitest';
afterAll(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
const message = { id: 'msg-a', chatId: 'chat-a', content: 'Minha viagem ao Marrocos', createdAt: '2026-09-11T12:00:00Z', attachments: [{ name: '../../photo.png', type: 'image/png', dataUri: 'data:image/png;base64,YQ==' }] };

it('archives safely before any model response and retrieves later by subject and description', () => {
  const [record] = archive.save(message);
  expect(record?.path).toMatch(/^Attachments\/[a-f0-9]+\/photo.png$/u);
  expect(files.read(record!.path)?.toString()).toBe('a');
  expect(archive.search('marrocos')[0]?.path).toBe(record!.path);
  expect(archive.describe(record!.path, 'Uma praça com árvores em Marrakech')).toBe(true);
  expect(archive.search('praca arvores')[0]?.path).toBe(record!.path);
  expect(provenance.listByChat('chat-a')).toContainEqual({ path: record!.path, createdAt: expect.any(String) });
  expect(archive.search('%')).toEqual([]);
});
it('keeps identically named uploads separate and makes retries of one message idempotent', () => {
 const first = archive.save(message)[0]!;
 archive.describe(first.path, 'Original description');
 expect(archive.save(message)[0]?.description).toBe('Original description');
 const second = archive.save({ ...message, id: 'msg-b', attachments: [{ ...message.attachments[0]!, dataUri: 'data:image/png;base64,Yg==' }] })[0]!;
 expect(second.path).not.toBe(first.path);
 expect(files.read(first.path)?.toString()).toBe('a');
 expect(files.read(second.path)?.toString()).toBe('b');
});
it('does not return a file moved to trash or claim it can update a missing attachment', () => {
 const record = archive.save(message)[0]!;
 files.remove(record.path);
 expect(archive.search('marrocos')).toEqual([]);
 expect(archive.describe(record.path, 'missing')).toBe(false);
});

it('exposes description search and a stable image reference through the agent tool', async () => {
 const record = archive.save(message)[0]!;
 const tools = buildFileTools(tool => tool, files, archive);
 const describe = tools.find(tool => tool.name === 'files_describe')!;
 await describe.execute('describe', { path: `Files/${record.path}`, description: 'Camel near a red wall' }, undefined, undefined, {} as never);
 const result = await tools.find(tool => tool.name === 'files_search')!.execute('search', { query: 'camel' }, undefined, undefined, {} as never);
 const output = JSON.stringify(result);
 expect(output).toContain(`attachment://${record.path}`);
 expect(output).toContain('external-content');
 expect(output).toContain('Camel near a red wall');
});
