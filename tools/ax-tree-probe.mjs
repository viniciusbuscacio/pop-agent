/**
 * Popy inspecting her own accessibility tree (Vinicius's question, 31/07).
 * Boots a throwaway popy (same pattern as tools/ui-crawl.ts), logs in,
 * opens the seeded chat, and dumps the aria snapshot of the chat screen.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const PASSWORD = 'ax tree experiment';

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const dataDir = mkdtempSync(join(tmpdir(), 'popy-crawl-')); // marker the sweepOrphans recognizes
const port = await freePort();
const base = `http://127.0.0.1:${port}`;

const child = spawn(process.execPath,
  [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), join(ROOT, 'server/src/main.ts')],
  { env: { ...process.env, POPY_PORT: String(port), POPY_BIND: '127.0.0.1',
           POPY_DATA_DIR: dataDir, POPY_AGENT: 'fake' },
    stdio: ['ignore', 'ignore', 'inherit'] });

try {
  // wait healthy
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) break;
    } catch {
      // not up yet; the deadline below is the real check
    }
    if (Date.now() > deadline) throw new Error('server not healthy');
    await new Promise(r => setTimeout(r, 200));
  }

  const setup = await (await fetch(`${base}/v1/setup`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: PASSWORD }) })).json();
  const chat = await (await fetch(`${base}/v1/chats`, { method: 'POST',
    headers: { authorization: `Bearer ${setup.token}` } })).json();

  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('[data-testid="login-password"]', PASSWORD);
    await page.click('[data-testid="login-submit"]');
    await page.goto(`${base}/chat/${chat.id}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-testid="chat-model"]', { timeout: 15000 });
    await page.waitForTimeout(400);

    const snapshot = await page.locator('body').ariaSnapshot();
    writeFileSync(join(process.env.HOME, 'popy-workspace/ax-chat-phone.yaml'), snapshot);
    console.log('=== aria snapshot (phone, chat screen) ===');
    console.log(snapshot);
    await page.screenshot({ path: join(process.env.HOME, 'popy-workspace/ax-chat-phone.png') });
  } finally {
    await browser.close();
  }
} finally {
  child.kill('SIGKILL');
  rmSync(dataDir, { recursive: true, force: true });
  console.log('throwaway server down, data dir removed');
}
