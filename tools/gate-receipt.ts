import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export interface GateReceipt {
  version: 1;
  tree: string;
  node: string;
  completedAt: string;
}

const repo = resolve(import.meta.dirname, '..');
const action = process.argv[2];
const runningPath = gitPath('pop-agent-gate-running.json');
const receiptPath = gitPath('pop-agent-gate-receipt.json');

if (action === 'begin') {
  rmSync(receiptPath, { force: true });
  atomicWrite(runningPath, { version: 1, tree: workingTree(), startedAt: new Date().toISOString() });
} else if (action === 'complete') {
  const began = JSON.parse(readFileSync(runningPath, 'utf8')) as { version?: number; tree?: string };
  const tree = workingTree();
  rmSync(runningPath, { force: true });
  if (began.version !== 1 || began.tree !== tree) {
    throw new Error('source tree changed while the gate was running; run npm run gate again');
  }
  atomicWrite(receiptPath, {
    version: 1,
    tree,
    node: process.version,
    completedAt: new Date().toISOString(),
  } satisfies GateReceipt);
} else {
  throw new Error('usage: gate-receipt.ts begin|complete');
}

function workingTree(): string {
  const scratch = mkdtempSync(join(tmpdir(), 'pop-gate-index-'));
  const index = join(scratch, 'index');
  const env = { ...process.env, GIT_INDEX_FILE: index };
  try {
    git(['read-tree', 'HEAD'], env);
    git(['add', '-A', '--', '.'], env);
    return git(['write-tree'], env);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function git(args: string[], env = process.env): string {
  return execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitPath(name: string): string {
  return resolve(repo, git(['rev-parse', '--git-path', name]));
}

function atomicWrite(path: string, value: unknown): void {
  const temporary = `${path}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
