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

interface StreamedEvent {
  kind: string;
  [field: string]: unknown;
}

interface StreamWatcher {
  events: StreamedEvent[];
  waitFor(predicate: (event: StreamedEvent) => boolean, what: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Opens the SSE stream the way the browser does: trade the session for a
 * one-time ticket, then connect with the ticket in the URL.
 */
async function openStream(base: string, token: string): Promise<StreamWatcher> {
  const issued = await call(base, '/v1/events/ticket', { method: 'POST', token });
  const { ticket } = issued.body as { ticket: string };

  const response = await fetch(`${base}/v1/events?ticket=${ticket}`);
  if (!response.ok || response.body === null) {
    throw new Error(`could not open the event stream: ${String(response.status)}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: StreamedEvent[] = [];
  let buffer = '';

  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          const match = /^data: (.+)$/.exec(line);
          if (match?.[1] !== undefined) events.push(JSON.parse(match[1]) as StreamedEvent);
        }
      }
    } catch {
      // the stream was closed; nothing left to read
    }
  })();

  return {
    events,
    async waitFor(predicate, what) {
      const deadline = Date.now() + 20_000;
      while (Date.now() < deadline) {
        if (events.some(predicate)) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(`timed out waiting for ${what}`);
    },
    async close() {
      await reader.cancel();
      await pump;
    },
  };
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
  const settingsDoc = {
    language: 'en',
    defaultModel: 'moonshotai/kimi-k3',
    serviceModel: 'moonshotai/kimi-k3',
    customInstructions: 'Keep answers short.',
    voiceModel: 'medium',
  };
  const written = await call(base, '/v1/settings', {
    method: 'PUT',
    token: created.token,
    body: settingsDoc,
  });
  expect(written.status === 200, 'settings PUT', `expected 200, got ${String(written.status)}`);
  const readBack = await call(base, '/v1/settings', { token: created.token });
  expect(
    JSON.stringify(readBack.body) === JSON.stringify(settingsDoc),
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

  // 10
  const chatResponse = await call(base, '/v1/chats', { method: 'POST', token: current });
  expect(chatResponse.status === 201, 'create chat', `expected 201, got ${String(chatResponse.status)}`);
  const chatId = (chatResponse.body as { id: string }).id;
  pass('a conversation can be created');

  // 11
  const watcher = await openStream(base, current);
  pass('the event stream accepts a one-time ticket');

  // 12
  await call(base, `/v1/chats/${chatId}/messages`, {
    method: 'POST',
    token: current,
    body: { text: 'tool: list the files' },
  });
  await watcher.waitFor((event) => event.kind === 'done', 'the run to finish');

  const kinds = watcher.events.map((event) => event.kind);
  for (const expected of ['title', 'run-status', 'thinking', 'tool', 'delta', 'done']) {
    expect(kinds.includes(expected), 'run events', `no ${expected} event arrived (saw ${kinds.join(', ')})`);
  }
  const toolStatuses = watcher.events
    .filter((event) => event.kind === 'tool')
    .map((event) => String(event['status']));
  expect(
    toolStatuses[0] === 'start' && toolStatuses[toolStatuses.length - 1] === 'done',
    'tool events',
    `tool statuses out of order: ${toolStatuses.join(', ')}`,
  );
  pass('a run streams thinking, a tool call and the answer, then finishes');

  // 13
  await call(base, `/v1/chats/${chatId}/messages`, {
    method: 'POST',
    token: current,
    body: { text: 'slow: keep going for a while' },
  });
  await watcher.waitFor(
    (event) => event.kind === 'run-status' && event['status'] === 'running',
    'the slow run to start',
  );
  await call(base, `/v1/chats/${chatId}/stop`, { method: 'POST', token: current });
  await watcher.waitFor(
    (event) => event.kind === 'error' && event['code'] === 'aborted',
    'the stopped run to report itself aborted',
  );
  pass('Stop aborts a running answer');

  // 14
  const history = await call(base, `/v1/chats/${chatId}/messages`, { token: current });
  const stored = (history.body as { messages: { role: string }[] }).messages;
  expect(
    stored.length >= 3 && stored[0]?.role === 'user' && stored[1]?.role === 'assistant',
    'history',
    `unexpected conversation shape: ${stored.map((message) => message.role).join(', ')}`,
  );
  pass('the conversation is on disk, in order');

  await watcher.close();
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
      // Explicit, not inherited: the smoke runs in the gate and in CI, and it
      // must cost nothing no matter what the machine's default engine is.
      POPY_AGENT: 'fake',
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
