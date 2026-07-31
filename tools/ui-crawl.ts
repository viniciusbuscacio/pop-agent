/**
 * Clicks every button in the UI so a human does not have to (Vinicius,
 * 31/07). Boots a throwaway popy — temp data dir, fake agent, zero tokens —
 * walks the screens at a desktop and a phone viewport, clicks everything
 * clickable, and reports what each click did: navigation, dialog, download,
 * file chooser, network, DOM change. The clicks that did NOTHING are where
 * broken buttons live.
 *
 * Not part of the gate — a hunting tool, run by hand:
 *   npm run ui:crawl
 * Screenshots and report.json land in /tmp/popy-ui-crawl/.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = '/tmp/popy-ui-crawl';
const PASSWORD = 'ui crawl password';

/** What one click did. Several can be true; none of them is the finding. */
interface Outcome {
  viewport: string;
  screen: string;
  button: string;
  navigated?: string;
  dialog?: string;
  download?: boolean;
  fileChooser?: boolean;
  requests: number;
  domChanged: boolean;
  consoleErrors: string[];
  verdict: 'ok' | 'NO-OP';
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close();
        reject(new Error('no ephemeral port'));
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
    if (child.exitCode !== null) throw new Error(`server exited: ${String(child.exitCode)}`);
    try {
      if ((await fetch(`${base}/healthz`)).ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('server not healthy in 30s');
}

async function api(
  base: string,
  path: string,
  options: { method?: string; body?: unknown; token?: string; form?: FormData } = {},
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.token !== undefined) headers['authorization'] = `Bearer ${options.token}`;
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.form !== undefined
      ? { body: options.form }
      : options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : {}),
  });
  if (!response.ok) throw new Error(`${path} -> ${String(response.status)}`);
  return response.headers.get('content-type')?.includes('json') === true
    ? response.json()
    : response.text();
}

/** Seeds enough content that list rows, menus and toolbars exist to click. */
async function seed(base: string): Promise<{ token: string; chatId: string; folderId: string }> {
  const created = (await api(base, '/v1/setup', {
    method: 'POST',
    body: { password: PASSWORD },
  })) as { token: string };
  const token = created.token;

  const chat = (await api(base, '/v1/chats', { method: 'POST', token })) as { id: string };
  const folder = (await api(base, '/v1/folders', {
    method: 'POST',
    token,
    body: { name: 'Docs' },
  })) as { id: string };

  const form = new FormData();
  form.append('file', new Blob(['hello from the crawler'], { type: 'text/plain' }), 'crawl.txt');
  await api(base, '/v1/artifacts', { method: 'POST', token, form });

  return { token, chatId: chat.id, folderId: folder.id };
}


/** The outcome the page-level listeners write into while one click settles. */
interface LiveOutcome {
  outcome: Outcome | undefined;
}

async function crawlScreen(
  page: Page,
  base: string,
  viewport: string,
  screen: string,
  live: LiveOutcome,
  results: Outcome[],
  unreached: string[],
): Promise<void> {
  const open = async (): Promise<void> => {
    await page.goto(`${base}${screen}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
  };
  await open();
  const shot = `${viewport}-${screen.replace(/[/?:=]+/g, '_') || 'home'}.png`;
  await page.screenshot({ path: join(OUT, shot), fullPage: false });

  const selector = 'button:visible, [role="button"]:visible, [role="menuitem"]:visible';
  const seen = new Set<string>();
  // Menus reveal buttons as we click; sweep until a pass finds nothing new.
  for (let pass = 0; pass < 3; pass += 1) {
    const ids = await page.$$eval(selector, (elements) =>
      elements
        .filter((element) => !(element as HTMLButtonElement).disabled)
        .map((element) => {
          const testId = element.getAttribute('data-testid');
          if (testId !== null) return `testid:${testId}`;
          const label = element.getAttribute('aria-label');
          if (label !== null) return `aria:${label}`;
          const text = (element.textContent ?? '').trim().slice(0, 40);
          return `text:${text.length > 0 ? text : '<unnamed>'}`;
        }),
    );
    const fresh = ids.filter((id) => !seen.has(id));
    console.log(
      `  [${viewport}] ${screen} pass ${String(pass)}: ${String(ids.length)} clickable, ${String(fresh.length)} new`,
    );
    if (fresh.length === 0) break;

    for (const id of fresh) {
      if (seen.has(id)) continue;
      seen.add(id);

      const outcome: Outcome = {
        viewport,
        screen,
        button: id,
        requests: 0,
        domChanged: false,
        consoleErrors: [],
        verdict: 'ok',
      };

      const mark = (wanted: string): Promise<boolean> =>
        page
          .$$eval(
            selector,
            // No named inner functions here: tsx/esbuild wraps them with a
            // __name helper that does not exist once Playwright serializes
            // the callback into the page.
            (elements, target) => {
              const index = elements.findIndex((element) => {
                const testId = element.getAttribute('data-testid');
                if (testId !== null) return `testid:${testId}` === target;
                const label = element.getAttribute('aria-label');
                if (label !== null) return `aria:${label}` === target;
                const text = (element.textContent ?? '').trim().slice(0, 40);
                return `text:${text.length > 0 ? text : '<unnamed>'}` === target;
              });
              elements.forEach((element) => element.removeAttribute('data-crawl-target'));
              if (index >= 0) elements[index]?.setAttribute('data-crawl-target', '1');
              return index >= 0;
            },
            wanted,
          )
          .catch(() => false);

      // In place first: a menu item only exists while the menu opened by the
      // previous click is still up. Reload and retry only when it is not there.
      let target = await mark(id);
      if (!target) {
        await open();
        target = await mark(id);
      }
      if (!target) {
        unreached.push(`[${viewport}] ${screen} -> ${id}`);
        continue;
      }
      let before = page.url();
      let beforeDom = await page.evaluate(() => document.body.innerHTML.length);
      live.outcome = outcome;
      let clicked = await page
        .click('[data-crawl-target="1"]', { timeout: 3000 })
        .then(() => true)
        .catch(() => false);
      if (!clicked) {
        // A leftover overlay from the previous in-place click can cover the
        // target; a fresh page settles that before we call a button broken.
        live.outcome = undefined;
        await open();
        if (!(await mark(id))) {
          unreached.push(`[${viewport}] ${screen} -> ${id}`);
          continue;
        }
        before = page.url();
        beforeDom = await page.evaluate(() => document.body.innerHTML.length);
        live.outcome = outcome;
        clicked = await page
          .click('[data-crawl-target="1"]', { timeout: 3000 })
          .then(() => true)
          .catch((error: unknown) => {
            outcome.consoleErrors.push(`click failed: ${String(error).slice(0, 120)}`);
            return false;
          });
      }
      await page.waitForTimeout(600);
      live.outcome = undefined;

      const afterDom = await page.evaluate(() => document.body.innerHTML.length).catch(() => beforeDom);
      outcome.domChanged = afterDom !== beforeDom;
      if (page.url() !== before) outcome.navigated = page.url().replace(base, '');

      const didAnything =
        outcome.navigated !== undefined ||
        outcome.dialog !== undefined ||
        outcome.download === true ||
        outcome.fileChooser === true ||
        outcome.requests > 0 ||
        outcome.domChanged;
      outcome.verdict = didAnything ? 'ok' : 'NO-OP';
      results.push(outcome);
    }
  }
}

async function main(): Promise<void> {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const dataDir = mkdtempSync(join(tmpdir(), 'popy-crawl-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${String(port)}`;

  const child = spawn(
    process.execPath,
    [join(ROOT, 'node_modules/tsx/dist/cli.mjs'), join(ROOT, 'server/src/main.ts')],
    {
      env: {
        ...process.env,
        POPY_PORT: String(port),
        POPY_BIND: '127.0.0.1',
        POPY_DATA_DIR: dataDir,
        POPY_AGENT: 'fake',
      },
      stdio: ['ignore', 'ignore', 'inherit'],
    },
  );

  const results: Outcome[] = [];
  const unreached: string[] = [];
  try {
    await waitForServer(base, child);
    const { chatId, folderId } = await seed(base);

    const browser = await chromium.launch();
    for (const [viewport, size] of [
      ['desktop', { width: 1280, height: 800 }],
      ['phone', { width: 390, height: 844 }],
    ] as const) {
      const context = await browser.newContext({ viewport: size });
      const page = await context.newPage();

      // One set of listeners per page, writing into whichever click is live:
      // per-click `once` handlers stack across iterations and double-handle
      // the first dialog that actually appears.
      const live: LiveOutcome = { outcome: undefined };
      page.on('console', (message) => {
        if (message.type() === 'error') {
          live.outcome?.consoleErrors.push(message.text().slice(0, 200));
        }
      });
      page.on('request', () => {
        if (live.outcome !== undefined) live.outcome.requests += 1;
      });
      page.on('dialog', (dialog) => {
        if (live.outcome !== undefined) live.outcome.dialog = dialog.type();
        void dialog.dismiss().catch(() => undefined);
      });
      page.on('download', (download) => {
        if (live.outcome !== undefined) live.outcome.download = true;
        void download.cancel().catch(() => undefined);
      });
      page.on('filechooser', () => {
        if (live.outcome !== undefined) live.outcome.fileChooser = true;
      });

      // Log in through the real form once per viewport.
      await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
      await page.fill('[data-testid="login-password"]', PASSWORD);
      await page.click('[data-testid="login-submit"]');
      await page.waitForURL(`${base}/`, { timeout: 10_000 });

      const screens = [
        '/',
        `/chat/${chatId}`,
        '/files',
        `/files/${folderId}`,
        `/chat/${chatId}/artifacts`,
        '/settings',
      ];
      for (const screen of screens) {
        await crawlScreen(page, base, viewport, screen, live, results, unreached);
      }
      await context.close();
    }
    await browser.close();
  } finally {
    child.kill('SIGKILL');
    rmSync(dataDir, { recursive: true, force: true });
  }

  writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 2));
  const noops = results.filter((entry) => entry.verdict === 'NO-OP');
  const errored = results.filter((entry) => entry.consoleErrors.length > 0);
  console.log(`\nclicked ${String(results.length)} buttons across ${String(new Set(results.map((r) => `${r.viewport} ${r.screen}`)).size)} screens`);
  for (const entry of noops) {
    console.log(`  NO-OP   [${entry.viewport}] ${entry.screen} -> ${entry.button}`);
  }
  for (const entry of errored) {
    console.log(`  JSERROR [${entry.viewport}] ${entry.screen} -> ${entry.button}: ${entry.consoleErrors[0] ?? ''}`);
  }
  if (noops.length === 0 && errored.length === 0) console.log('  every clicked button did something.');
  // No silent caps: a button we enumerated but never managed to click is a
  // coverage hole, not a pass.
  for (const entry of unreached) console.log(`  UNREACHED ${entry}`);
  console.log(`\nreport: ${join(OUT, 'report.json')}  screenshots: ${OUT}/`);
}

await main();
