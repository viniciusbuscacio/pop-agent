import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * End-to-end smoke test (popy.spec §20).
 *
 * Unit tests build the app in-process; this one starts the real server as its
 * own process against a throwaway data directory and talks to it over HTTP,
 * which is the only way to catch the failures that live between the pieces --
 * a migration that does not run at boot, a route that is not mounted, a build
 * that never produced a frontend.
 *
 * Deliberately free of a test framework: it is a script that exits 0 or 1, so
 * it runs identically in the gate, in CI and by hand while debugging.
 *
 * Phase 2 extends this same file with the chat over a fake provider.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SERVER_MAIN = join(ROOT, 'server/src/main.ts');
const TSX_CLI = join(ROOT, 'node_modules/tsx/dist/cli.mjs');

const PASSWORD = 'smoke test password';
const NEW_PASSWORD = 'smoke test password two';

let step = 0;

function pass(what: string): void {
  step += 1;
  console.log(`  ok ${String(step)}. ${what}`);
}

function fail(what: string, detail: string): never {
  console.error(`  FAILED at ${what}: ${detail}`);
  throw new Error(`${what}: ${detail}`);
}

function expect(condition: boolean, what: string, detail: string): void {
  if (!condition) fail(what, detail);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('could not obtain an ephemeral port'));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(base: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${String(child.exitCode)}`);
    }
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('server did not become healthy within 30s');
}

interface Call {
  status: number;
  body: unknown;
  contentType: string;
}

async function call(
  base: string,
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<Call> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;

  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const contentType = response.headers.get('content-type') ?? '';
  const body: unknown = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  return { status: response.status, body, contentType };
}

async function run(base: string): Promise<void> {
  // 1
  const health = await call(base, '/healthz');
  expect(health.status === 200, 'healthz', `expected 200, got ${String(health.status)}`);
  pass('healthz answers');

  // 2
  const stateBefore = await call(base, '/v1/auth/state');
  expect(
    JSON.stringify(stateBefore.body) === JSON.stringify({ setupDone: false }),
    'auth/state before setup',
    `expected setupDone:false, got ${JSON.stringify(stateBefore.body)}`,
  );
  pass('a fresh install reports that setup is pending');

  // 3
  const setup = await call(base, '/v1/setup', { method: 'POST', body: { password: PASSWORD } });
  expect(setup.status === 200, 'setup', `expected 200, got ${String(setup.status)}`);
  const created = setup.body as { recoveryKey: string; token: string };
  expect(
    /^[A-Z2-9]{4}(-[A-Z2-9]{4}){5}$/.test(created.recoveryKey),
    'setup',
    `recovery key has an unexpected shape: ${created.recoveryKey}`,
  );
  pass('setup creates the account and returns a recovery key');

  // 4
  const guarded = await call(base, '/v1/settings');
  expect(guarded.status === 401, 'settings without a token', `expected 401, got ${String(guarded.status)}`);
  const settings = await call(base, '/v1/settings', { token: created.token });
  expect(settings.status === 200, 'settings with a token', `expected 200, got ${String(settings.status)}`);
  pass('settings are refused without a session and served with one');

  // 5
  const written = await call(base, '/v1/settings', {
    method: 'PUT',
    token: created.token,
    body: { language: 'en' },
  });
  expect(written.status === 200, 'settings PUT', `expected 200, got ${String(written.status)}`);
  const readBack = await call(base, '/v1/settings', { token: created.token });
  expect(
    JSON.stringify(readBack.body) === JSON.stringify({ language: 'en' }),
    'settings roundtrip',
    `read back ${JSON.stringify(readBack.body)}`,
  );
  pass('settings survive a write and a read');

  // 6
  const changed = await call(base, '/v1/auth/change-password', {
    method: 'POST',
    token: created.token,
    body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
  });
  expect(changed.status === 200, 'change-password', `expected 200, got ${String(changed.status)}`);
  const afterChange = (changed.body as { token: string }).token;

  const staleToken = await call(base, '/v1/settings', { token: created.token });
  expect(
    staleToken.status === 401,
    'old token after password change',
    `expected 401, got ${String(staleToken.status)}`,
  );
  const freshToken = await call(base, '/v1/settings', { token: afterChange });
  expect(
    freshToken.status === 200,
    'new token after password change',
    `expected 200, got ${String(freshToken.status)}`,
  );
  pass('changing the password drops old sessions and keeps the caller signed in');

  // 7
  const recovered = await call(base, '/v1/auth/recover', {
    method: 'POST',
    body: { recoveryKey: created.recoveryKey, newPassword: PASSWORD },
  });
  expect(recovered.status === 200, 'recover', `expected 200, got ${String(recovered.status)}`);
  const replacement = recovered.body as { token: string; recoveryKey: string };
  expect(
    replacement.recoveryKey !== created.recoveryKey,
    'recover',
    'the recovery key was not replaced',
  );
  const spent = await call(base, '/v1/auth/recover', {
    method: 'POST',
    body: { recoveryKey: created.recoveryKey, newPassword: NEW_PASSWORD },
  });
  expect(spent.status === 401, 'spent recovery key', `expected 401, got ${String(spent.status)}`);
  pass('recovery spends the key it was given and issues a new one');

  // 8
  const signedOut = await call(base, '/v1/auth/sign-out-others', {
    method: 'POST',
    token: replacement.token,
  });
  expect(signedOut.status === 200, 'sign-out-others', `expected 200, got ${String(signedOut.status)}`);
  const current = (signedOut.body as { token: string }).token;
  const stillIn = await call(base, '/v1/settings', { token: current });
  expect(stillIn.status === 200, 'sign-out-others', 'the calling device lost its session');
  pass('signing out other devices leaves this one signed in');

  // 9
  const shell = await call(base, '/');
  expect(shell.status === 200, 'frontend', `expected 200, got ${String(shell.status)}`);
  expect(
    shell.contentType.includes('text/html') && String(shell.body).includes('<div id="root">'),
    'frontend',
    'the built single-page app was not served',
  );
  pass('the built frontend is served');
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'popy-smoke-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${String(port)}`;

  console.log(`smoke: starting popy on ${base} with data in ${dataDir}`);
  const child = spawn(process.execPath, [TSX_CLI, SERVER_MAIN], {
    env: {
      ...process.env,
      POPY_PORT: String(port),
      POPY_BIND: '127.0.0.1',
      POPY_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const serverLog: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => serverLog.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => serverLog.push(chunk.toString()));

  let failure: unknown;
  try {
    await waitForServer(base, child);
    await run(base);
  } catch (error) {
    failure = error;
  } finally {
    child.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
  }

  if (failure !== undefined) {
    console.error('\nsmoke FAILED');
    console.error(failure instanceof Error ? failure.message : String(failure));
    if (serverLog.length > 0) console.error(`\nserver output:\n${serverLog.join('')}`);
    process.exit(1);
  }

  console.log('smoke passed');
  process.exit(0);
}

await main();
