import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('persists native Desktop zoom within the supported bounds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pop-desktop-zoom-'));
  try {
    const executable = join(directory, 'probe');
    await promisify(execFile)('clang', [
      '-fobjc-arc',
      '-framework',
      'Cocoa',
      '-framework',
      'WebKit',
      resolve('tools/fixtures/macos-desktop-zoom.m'),
      '-o',
      executable,
    ]);
    const suite = `com.popagent.desktop.zoom-test.${process.pid}`;
    const writeResult = await promisify(execFile)(executable, [suite, 'write']);
    expect(writeResult.stdout).toContain('PASS:');
    const readResult = await promisify(execFile)(executable, [suite, 'read']);
    expect(readResult.stdout).toContain('PASS:');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
