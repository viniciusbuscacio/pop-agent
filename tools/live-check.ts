/**
 * The one test that spends money (docs/specs/Spec-Pop-General.md §20, Phase 3).
 *
 * Everything else about the chat is proved against the fake bridge and costs
 * nothing: the gate, the smoke, CI. This file exists for the one question none
 * of them can answer -- whether the path from Pop Agent through pi to a real model
 * and back actually works -- and so it is deliberately not in the gate. Run it
 * by hand, read the cost it prints, close the terminal.
 *
 *   npx tsx tools/live-check.ts            one short message
 *   npx tsx tools/live-check.ts --tools    also runs bash, then aborts it
 *
 * The key comes from OPENROUTER_API_KEY, or from the repo's .env if that is
 * where it lives.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { AgentEvent } from '../server/src/application/ports/agent-bridge.js';
import { PiAgentBridge, type PiRunUsage } from '../server/src/infrastructure/agent/pi-bridge.js';
import {
  DEFAULT_MODEL_ID,
  SdkPiEngine,
} from '../server/src/infrastructure/agent/pi-engine.js';
import { migrate } from '../server/src/infrastructure/db/migrate.js';
import { SqliteChatRepo } from '../server/src/infrastructure/db/sqlite-chat-repo.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const withTools = process.argv.includes('--tools');
const CHAT_ID = 'chat-live00000001';

function apiKey(): string {
  const fromEnv = process.env['OPENROUTER_API_KEY'];
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;

  // The dev server keeps it in .env, which systemd reads and a shell does not.
  const envFile = join(repoRoot, '.env');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf8').split('\n')) {
      const match = /^\s*(?:export\s+)?OPENROUTER_API_KEY\s*=\s*(.*)$/.exec(line);
      if (match?.[1] !== undefined) return match[1].trim().replace(/^["']|["']$/g, '');
    }
  }

  console.error('live-check: no OPENROUTER_API_KEY (env or .env). Nothing was spent.');
  process.exit(1);
}

function report(label: string, events: AgentEvent[], usage: PiRunUsage | undefined): boolean {
  const text = events
    .filter((event): event is Extract<AgentEvent, { kind: 'delta' }> => event.kind === 'delta')
    .map((event) => event.text)
    .join('');
  const thinking = events.filter((event) => event.kind === 'thinking').length;
  const tools = events.filter((event) => event.kind === 'tool').length;
  const failure = events.find(
    (event): event is Extract<AgentEvent, { kind: 'error' }> => event.kind === 'error',
  );

  console.log(`\n── ${label} ──`);
  console.log(`answer:   ${JSON.stringify(text.slice(0, 400))}`);
  console.log(`events:   ${String(thinking)} thinking, ${String(tools)} tool`);
  if (usage !== undefined) {
    console.log(
      `cost:     ${String(usage.inputTokens)} in + ${String(usage.outputTokens)} out = ` +
        `US$ ${usage.cost.toFixed(6)}`,
    );
  } else {
    console.log('cost:     not reported');
  }
  if (failure !== undefined) console.log(`error:    ${failure.code}`);

  return failure === undefined && text.length > 0;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls a condition until it holds or the budget runs out. */
async function waitFor(condition: () => boolean, budgetMs: number): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (condition()) return true;
    await delay(250);
  }
  return condition();
}

async function waitForProcess(pattern: string, budgetMs: number): Promise<string[]> {
  await waitFor(() => processesMatching(pattern).length > 0, budgetMs);
  return processesMatching(pattern);
}

function processesMatching(pattern: string): string[] {
  try {
    const out = execFileSync('pgrep', ['-f', pattern], { encoding: 'utf8' });
    return out.split('\n').filter((line) => line.trim().length > 0);
  } catch {
    return []; // pgrep exits non-zero when nothing matches
  }
}

async function main(): Promise<void> {
  const key = apiKey();
  const dataDir = mkdtempSync(join(tmpdir(), 'pop-agent-live-'));
  const workspace = mkdtempSync(join(tmpdir(), 'pop-agent-live-workspace-'));

  const db = new Database(join(dataDir, 'live.db'));
  db.pragma('foreign_keys = ON');
  migrate(db);
  const chats = new SqliteChatRepo(db);
  const now = new Date().toISOString();
  chats.create({
    id: CHAT_ID,
    title: 'live check',
    model: DEFAULT_MODEL_ID,
    provider: 'openrouter',
    archived: false,
    pinned: false,
    piSessionId: '',
    summary: '',
    autoTitle: true,
    createdAt: now,
    updatedAt: now,
  });

  // One entry per run, in order: the value arrives through a callback, and a
  // variable reassigned from one would read as narrowed to nothing here.
  const usages: PiRunUsage[] = [];
  const bridge = new PiAgentBridge({
    chats,
    engine: new SdkPiEngine({
      workspace,
      sessionsDir: join(dataDir, 'sessions'),
      agentDir: join(dataDir, 'pi-agent'),
      authPath: join(dataDir, 'pi-auth.json'),
      modelsStorePath: join(dataDir, 'pi-models-store.json'),
      apiKey: () => key,
    }),
    onUsage: (reported) => {
      usages.push(reported);
    },
    onFailure: (failure) => {
      console.error(`live-check: ${failure.code} -- ${failure.message ?? 'no detail'}`);
    },
  });

  let ok = true;
  let spent = 0;

  console.log(`live-check: model ${DEFAULT_MODEL_ID}, workspace ${workspace}`);

  try {
    // 1. The whole point: a real token, end to end.
    const events: AgentEvent[] = [];
    await bridge.run({
      chatId: CHAT_ID,
      prompt: 'Reply with exactly: ok',
      model: DEFAULT_MODEL_ID,
      attachments: [],
      onEvent: (event) => events.push(event),
      signal: new AbortController().signal,
    });
    ok = report('one short message', events, usages[0]) && ok;
    spent += usages[0]?.cost ?? 0;

    const sessionFile = chats.get(CHAT_ID)?.piSessionId ?? '';
    console.log(`session:  ${sessionFile === '' ? 'NOT RECORDED' : sessionFile}`);
    ok = sessionFile !== '' && ok;

    if (withTools) {
      // 2. Stop is a kill (spec §5): the shell child must die with the run.
      //
      // The child is found by its own command line, not by a marker in the
      // prompt: pi hands the command to the shell on stdin, so nothing Pop Agent
      // wrote ever shows up in `ps`. An odd duration is the closest thing to a
      // unique name a bare `sleep` can have.
      const toolEvents: AgentEvent[] = [];
      const controller = new AbortController();
      const running = bridge.run({
        chatId: CHAT_ID,
        prompt: 'Run this bash command and report the result: sleep 47',
        model: DEFAULT_MODEL_ID,
      attachments: [],
        onEvent: (event) => toolEvents.push(event),
        signal: controller.signal,
      });

      const startedTool = await waitFor(
        () => toolEvents.some((event) => event.kind === 'tool' && event.status === 'start'),
        60_000,
      );
      const before = startedTool ? await waitForProcess('sleep 47', 15_000) : [];
      console.log(
        `
bash child before stop: ${before.length === 0 ? 'never seen' : before.join(', ')}`,
      );

      controller.abort();
      await running;
      await delay(1000);

      const after = processesMatching('sleep 47');
      console.log(`bash child after stop:  ${after.length === 0 ? 'gone' : after.join(', ')}`);
      report('bash, then Stop', toolEvents, usages[1]);
      spent += usages[1]?.cost ?? 0;

      if (before.length === 0) {
        // The model may simply not have run it. That says nothing about Stop.
        console.log('Stop: INCONCLUSIVE -- the shell child was never observed.');
      } else if (after.length === 0) {
        console.log('Stop killed the process group.');
      } else {
        console.log('Stop did NOT kill the child.');
        ok = false;
      }
    }
  } finally {
    bridge.close();
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(workspace, { recursive: true, force: true });
  }

  console.log(`\nlive-check: ${ok ? 'PASS' : 'FAIL'} -- US$ ${spent.toFixed(6)} spent`);
  if (!ok) process.exit(1);
}

await main();
