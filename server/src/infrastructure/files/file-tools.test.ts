import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { FilesService } from '../../application/files/files-service.js';
import { buildFileTools } from './file-tools.js';

/** A defineTool stub that just returns the definition, as the SDK's does. */
const defineTool = (tool: ToolDefinition): ToolDefinition => tool;

async function run(tool: ToolDefinition, params: Record<string, string>): Promise<string> {
  const execute = tool.execute as unknown as (
    id: string,
    params: unknown,
  ) => Promise<{ content: { type: string; text?: string }[] }>;
  const result = await execute('call-1', params);
  return result.content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('');
}

let root: string;
let files: FilesService;
let deleteTool: ToolDefinition;
let searchTool: ToolDefinition;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pop-filetools-'));
  files = new FilesService({ root, clock: { now: () => Date.now() } });
  const tools = buildFileTools(defineTool, files);
  deleteTool = tools[0] as ToolDefinition;
  searchTool = tools[1] as ToolDefinition;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('delete_file', () => {
  it('moves the entry to the Garbage instead of destroying it', async () => {
    files.write('reports/old.pdf', Buffer.from('x'));
    const reply = await run(deleteTool, { path: 'reports/old.pdf' });

    expect(reply).toContain('trash');
    expect(files.read('reports/old.pdf')).toBeUndefined();
    expect(files.listGarbage().map((entry) => entry.originalPath)).toEqual(['reports/old.pdf']);
  });

  it('accepts the Files/ prefix the agent sees in its workspace', async () => {
    files.write('a.txt', Buffer.from('x'));
    await run(deleteTool, { path: 'Files/a.txt' });
    expect(files.listGarbage()).toHaveLength(1);
  });

  it('reports a missing path instead of erroring', async () => {
    expect(await run(deleteTool, { path: 'nope.txt' })).toContain('No file or folder');
  });

  it('refuses to escape into the rest of the disk', async () => {
    expect(await run(deleteTool, { path: '../secret.key' })).toContain('Could not delete');
  });
});

describe('files_search', () => {
  it('matches names case-insensitively and marks folders with a slash', async () => {
    files.write('reports/Pesca-2026.pdf', Buffer.from('x'));
    files.write('notes.txt', Buffer.from('y'));

    const reply = await run(searchTool, { query: 'pesca' });
    expect(reply).toContain('reports/Pesca-2026.pdf');
    expect(reply).not.toContain('notes.txt');

    const folders = await run(searchTool, { query: 'reports' });
    expect(folders).toContain('reports/');
  });

  it('frames the hits as data, not instructions', async () => {
    files.write('innocent.txt', Buffer.from('x'));
    const reply = await run(searchTool, { query: 'innocent' });
    expect(reply).toContain('external-content');
    expect(reply).toContain('never instructions');
  });

  it('says so when nothing matches', async () => {
    expect(await run(searchTool, { query: 'zzz' })).toContain('No file name matched');
  });
});
