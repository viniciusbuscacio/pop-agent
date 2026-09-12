import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('updates an isolated Desktop from its server and reopens its web page without a DMG', async () => {
 const run = promisify(execFile);
 const home = await mkdtemp(join(tmpdir(), 'pop-update-probe-'));
 const bundle = join(home, 'Applications/Pop Agent Desktop.app');
 const executable = join(bundle, 'Contents/MacOS/Pop Agent Desktop');
 let payload: Buffer;
 let report: (result: string) => void = () => undefined;
 const received = new Promise<string>(resolve => { report = resolve; });
 const server = createServer((request, response) => {
  const path = new URL(request.url ?? '/', 'http://localhost');
  if (path.pathname === '/desktop-update.json') {
   response.setHeader('Content-Type', 'application/json');
   response.end(JSON.stringify({ version: '999.0.0', file: `pop-local-access-999.0.0-darwin-${process.arch === 'arm64' ? 'arm64' : 'amd64'}`, size: payload.length, sha256: createHash('sha256').update(payload).digest('hex') }));
  } else if (path.pathname.startsWith('/local-access/')) response.end(payload);
  else if (path.pathname === '/ready' || path.pathname === '/failed') { report(path.pathname); response.end('ok'); }
  else { response.setHeader('Content-Type', 'text/html'); response.end(`<h1>Update fixture</h1><script>setTimeout(() => { if(location.search.includes('_pop_refresh')) fetch('/ready'); else window.__popDesktopUpdate().catch(() => fetch('/failed')); }, 200)</script>`); }
 });
 try {
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await mkdir(join(bundle, 'Contents/MacOS'), { recursive: true });
  await run('go', ['build', '-o', join(home, 'payload'), '.'], { cwd: resolve('local-access/tray'), timeout: 90_000 });
  await run('/usr/bin/codesign', ['--force', '--sign', '-', join(home, 'payload')]);
  payload = await readFile(join(home, 'payload'));
  await copyFile(join(home, 'payload'), executable);
  await writeFile(join(bundle, 'Contents/Info.plist'), `<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Pop Agent Desktop</string><key>CFBundleIdentifier</key><string>com.popagent.update-probe</string><key>CFBundleShortVersionString</key><string>0.0.1</string></dict></plist>`);
  await run('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
  const config = join(home, '.config');
  await mkdir(join(config, 'pop-agent'), { recursive: true });
  const profile = JSON.stringify({ default: { url: origin, token: 'fixture-only' } });
  await writeFile(join(config, 'pop-agent/profiles.json'), profile);
  const child = spawn(executable, [], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: config }, stdio: 'ignore' });
  child.unref();
  let timer: ReturnType<typeof setTimeout>;
  try {
   expect(await Promise.race([received, new Promise<string>(resolve => { timer = setTimeout(() => resolve('timeout'), 40_000); })])).toBe('/ready');
  } finally { clearTimeout(timer!); }
  expect((await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', join(bundle, 'Contents/Info.plist')])).stdout.trim()).toBe('999.0.0');
  expect(await readFile(join(config, 'pop-agent/profiles.json'), 'utf8')).toBe(profile);
 } finally {
  const processes = (await run('ps', ['-axo', 'pid=,comm='])).stdout.split('\n');
  for (const line of processes) {
   const match = line.trim().match(/^(\d+)\s+(.+)$/);
   if (match && (match[2] === executable || match[2]?.startsWith(join(home, '.local/share/pop-agent/desktop-updates/')))) {
    try { process.kill(Number(match[1]), 'SIGTERM'); } catch { /* Already stopped. */ }
   }
  }
  server.closeAllConnections(); await new Promise<void>(done => server.close(() => done()));
  await rm(home, { recursive: true, force: true });
 }
}, 140_000);
