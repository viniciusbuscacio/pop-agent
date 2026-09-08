import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyPendingRestore, prepareBrowserRestore, readRestoreStatus } from './browser-restore.js';

let root: string;
let data: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pop-browser-restore-test-'));
  data = join(root, 'data');
  await mkdir(data);
  await writeFile(join(data, 'secret.key'), 'host-key', { mode: 0o600 });
  await writeFile(join(data, 'value'), 'current');
  await writeFile(join(data, 'newer-file'), 'keep only in recovery');
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const extract = async (destination: string): Promise<void> => { await writeFile(join(destination, 'value'), 'snapshot'); };

describe('browser restore cold-boot transaction', () => {
  it('prepares without changing live data, then replaces the full directory and retains recovery data', async () => {
    await mkdir(join(data, 'models'));
    await writeFile(join(data, 'models', 'cached'), 'existing download');
    await prepareBrowserRestore(data, extract);
    expect(await readFile(join(data, 'value'), 'utf8')).toBe('current');
    await applyPendingRestore(data);
    expect(await readFile(join(data, 'value'), 'utf8')).toBe('snapshot');
    expect(await readFile(join(data, 'secret.key'), 'utf8')).toBe('host-key');
    expect(existsSync(join(data, 'newer-file'))).toBe(false);
    expect(await readFile(join(data, 'models', 'cached'), 'utf8')).toBe('existing download');
    expect(readRestoreStatus(data).state).toBe('restored');
    const { readdir } = await import('node:fs/promises');
    const recovery = (await readdir(root)).find((name) => name.startsWith('data.before-restore-'));
    expect(await readFile(join(root, recovery ?? '', 'original', 'value'), 'utf8')).toBe('current');
    await applyPendingRestore(data); // subsequent starts do not replay a restore
    expect(await readFile(join(data, 'value'), 'utf8')).toBe('snapshot');
  });

  it('does not arm a restore when archive validation fails', async () => {
    await expect(prepareBrowserRestore(data, () => Promise.reject(new Error('wrong password')))).rejects.toThrow('wrong password');
    await applyPendingRestore(data);
    expect(await readFile(join(data, 'value'), 'utf8')).toBe('current');
    expect(existsSync(`${data}.restore-pending`)).toBe(false);
  });

  it('discards interrupted preparation without installing partial data', async () => {
    await mkdir(`${data}.restore-pending`);
    await writeFile(join(`${data}.restore-pending`, 'partial'), 'partial');
    await applyPendingRestore(data);
    expect(await readFile(join(data, 'value'), 'utf8')).toBe('current');
    expect(readRestoreStatus(data).state).toBe('failed');
  });

  it('resumes a crash after moving the old data and before installing the snapshot', async () => {
    await prepareBrowserRestore(data, extract);
    await rename(data, join(`${data}.restore-pending`, 'original'));
    await applyPendingRestore(data);
    expect(await readFile(join(data, 'value'), 'utf8')).toBe('snapshot');
  });

  it('finalizes a crash after installing the snapshot without overwriting recovery data', async () => {
    await prepareBrowserRestore(data, extract);
    await rename(data, join(`${data}.restore-pending`, 'original'));
    await rename(join(`${data}.restore-pending`, 'data'), data);
    await applyPendingRestore(data);
    expect(readRestoreStatus(data).state).toBe('restored');
  });

  it('rolls back if the staged directory cannot be installed', async () => {
    await prepareBrowserRestore(data, extract);
    await rm(join(`${data}.restore-pending`, 'data'), { recursive: true });
    await applyPendingRestore(data);
    expect(await readFile(join(data, 'value'), 'utf8')).toBe('current');
    expect(readRestoreStatus(data).state).toBe('failed');
  });
});
