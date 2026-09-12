import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('downloads in the native WebView without replacing the page or previous files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pop-desktop-download-'));
  const server = createServer((request, response) => {
    if (request.url === '/fixture') {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="fixture.dmg"' });
      response.end('download-fixture');
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<a href="/fixture" download="fixture.dmg">Download</a>');
    }
  });
  try {
    await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
    const port = (server.address() as { port: number }).port;
    const executable = join(directory, 'probe');
    await promisify(execFile)('clang', ['-fobjc-arc', '-framework', 'Cocoa', '-framework', 'WebKit', resolve('tools/fixtures/macos-desktop-download.m'), '-o', executable]);
    const result = await promisify(execFile)(executable, [`http://127.0.0.1:${port}/`, directory], { timeout: 35_000 }).catch((error: Error & { code?: unknown; signal?: string }) => { throw new Error(`${error.message} code=${String(error.code)} signal=${error.signal}`); });
    expect(result.stdout).toContain('PASS:');
    expect(await readFile(join(directory, 'fixture.dmg'), 'utf8')).toBe('download-fixture');
    expect(await readFile(join(directory, 'fixture (1).dmg'), 'utf8')).toBe('download-fixture');
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
}, 45_000);
