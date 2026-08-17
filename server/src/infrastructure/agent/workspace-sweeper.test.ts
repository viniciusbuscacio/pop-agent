import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WorkspaceSweeper } from './workspace-sweeper.js';

/**
 * The orphan sweep (docs/specs/Spec-Pop-General.md §21). Most of what this asserts is what the
 * sweep must NOT touch: a conservative job that deleted one file too many
 * would be worse than no job at all.
 */

const NOW = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;

let workspace: string;
let journal: string[];

function file(path: string, ageDays = 0): string {
  const full = join(workspace, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, 'x');
  const seconds = (NOW - ageDays * DAY_MS) / 1000;
  utimesSync(full, seconds, seconds);
  return full;
}

function dir(path: string): string {
  const full = join(workspace, path);
  mkdirSync(full, { recursive: true });
  return full;
}

function sweeper(live: string[], scratchMaxAgeMs = 30 * DAY_MS): WorkspaceSweeper {
  return new WorkspaceSweeper({
    workspace,
    liveChatIds: () => new Set(live),
    now: () => NOW,
    scratchMaxAgeMs,
    onJournal: (line) => journal.push(line),
  });
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'pop-sweep-'));
  journal = [];
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('orphan attachments', () => {
  it('removes the folders of chats that no longer exist and keeps the rest', () => {
    file('attachments/chat-alive1/note.txt');
    file('attachments/chat-dead01/note.txt');
    file('attachments/chat-dead02/note.txt');

    const result = sweeper(['chat-alive1']).sweep();

    expect(result.attachments).toBe(2);
    expect(existsSync(join(workspace, 'attachments/chat-alive1'))).toBe(true);
    expect(existsSync(join(workspace, 'attachments/chat-dead01'))).toBe(false);
    expect(existsSync(join(workspace, 'attachments/chat-dead02'))).toBe(false);
  });

  it('leaves a stray file directly under attachments/ alone', () => {
    // Only directories are chat folders; a file there is somebody's, not ours.
    file('attachments/README.md');

    expect(sweeper([]).sweep().attachments).toBe(0);
    expect(existsSync(join(workspace, 'attachments/README.md'))).toBe(true);
  });

  it('does nothing at all when there is no attachments directory', () => {
    expect(() => sweeper([]).sweep()).not.toThrow();
    expect(sweeper([]).sweep().attachments).toBe(0);
  });
});

describe('scratch files in the workspace root', () => {
  it('removes only the known temp extensions, and only when old enough', () => {
    file('chart.png', 40);
    file('plan.yaml', 31);
    file('script.mjs', 90);
    file('fresh.png', 3); // young
    file('notes.md', 400); // old, but not a known scratch extension
    file('report.pdf', 400);

    const result = sweeper([]).sweep();

    expect(result.scratch).toBe(3);
    expect(existsSync(join(workspace, 'chart.png'))).toBe(false);
    expect(existsSync(join(workspace, 'plan.yaml'))).toBe(false);
    expect(existsSync(join(workspace, 'script.mjs'))).toBe(false);
    expect(existsSync(join(workspace, 'fresh.png'))).toBe(true);
    expect(existsSync(join(workspace, 'notes.md'))).toBe(true);
    expect(existsSync(join(workspace, 'report.pdf'))).toBe(true);
  });

  it('never descends into a directory: a project is not scratch', () => {
    file('my-project/old.png', 400);
    dir('empty-thing');

    const result = sweeper([]).sweep();

    expect(result.scratch).toBe(0);
    expect(existsSync(join(workspace, 'my-project/old.png'))).toBe(true);
    expect(existsSync(join(workspace, 'empty-thing'))).toBe(true);
  });

  it('does not touch a live chat\'s attachments even when they are ancient', () => {
    file('attachments/chat-alive1/old.png', 400);

    sweeper(['chat-alive1']).sweep();

    expect(existsSync(join(workspace, 'attachments/chat-alive1/old.png'))).toBe(true);
  });
});

describe('the job', () => {
  it('is daily, and writes exactly one journal line with the counts', () => {
    file('attachments/chat-dead01/x.txt');
    file('old.png', 40);

    const job = sweeper([]);
    expect(job.name).toBe('workspace-sweep');
    expect(job.everyMs).toBe(DAY_MS);

    job.run();

    expect(journal).toHaveLength(1);
    expect(journal[0]).toBe('pop sweep: orphan attachment folders=1 scratch files=1');
  });

  it('sweeps nothing, loudly, when there is nothing to sweep', () => {
    sweeper([]).run();

    expect(journal).toEqual(['pop sweep: orphan attachment folders=0 scratch files=0']);
  });
});
