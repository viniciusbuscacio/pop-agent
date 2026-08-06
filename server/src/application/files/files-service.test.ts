import { mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Clock } from '../ports/clock.js';
import { FilesService, TRASH_RETENTION_MS } from './files-service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

class TestClock implements Clock {
  constructor(private ms: number = 1_800_000_000_000) {}
  now(): number {
    return this.ms;
  }
  advance(byMs: number): void {
    this.ms += byMs;
  }
}

let root: string;
let clock: TestClock;
let changed: number;
let files: FilesService;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-files-'));
  clock = new TestClock();
  changed = 0;
  files = new FilesService({ root, clock, onChanged: () => (changed += 1) });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('the tree', () => {
  it('lists real names, folders first, and hides Garbage and dotfiles', () => {
    files.write('b.txt', Buffer.from('b'));
    files.write('reports/a.pdf', Buffer.from('a'));
    writeFileSync(join(root, '.hidden'), 'x');

    const tree = files.tree();
    expect(tree.map((n) => n.path)).toEqual(['reports', 'b.txt']);
    expect(tree[0]?.children?.map((n) => n.path)).toEqual(['reports/a.pdf']);
  });

  it('overwrites on a re-save: same path, new bytes, no versions', () => {
    files.write('r.txt', Buffer.from('one'));
    files.write('r.txt', Buffer.from('two'));
    expect(files.read('r.txt')?.toString()).toBe('two');
    expect(files.tree()).toHaveLength(1);
  });

  it('moves and renames as one path edit, refusing an occupied target', () => {
    files.write('a.txt', Buffer.from('a'));
    files.write('b.txt', Buffer.from('b'));
    expect(files.move('a.txt', 'sub/renamed.txt')).toBe('ok');
    expect(files.read('sub/renamed.txt')?.toString()).toBe('a');
    expect(files.move('b.txt', 'sub/renamed.txt')).toBe('target-exists');
    expect(files.move('missing.txt', 'x.txt')).toBe('not-found');
  });

  it('tells the catalog after every mutation', () => {
    files.write('a.txt', Buffer.from('a'));
    files.mkdir('dir');
    files.move('a.txt', 'dir/a.txt');
    files.remove('dir/a.txt');
    expect(changed).toBe(4);
  });
});

describe('the jail', () => {
  it('refuses .. and absolute paths', () => {
    expect(() => files.read('../secret.key')).toThrow();
    expect(() => files.write('/etc/passwd', Buffer.from('x'))).toThrow();
  });

  it('refuses dotfile paths -- they are reserved for Popy', () => {
    expect(() => files.write('.garbage.json', Buffer.from('{}'))).toThrow();
    expect(() => files.read('Garbage/.garbage.json')).toThrow();
  });

  it('refuses reaching into Garbage through the normal operations', () => {
    files.write('a.txt', Buffer.from('a'));
    files.remove('a.txt');
    expect(() => files.read('Garbage/a.txt')).toThrow();
    expect(() => files.write('Garbage/planted.txt', Buffer.from('x'))).toThrow();
  });

  it('follows a symlinked folder and refuses it when it escapes', () => {
    const outside = mkdtempSync(join(tmpdir(), 'popy-outside-'));
    writeFileSync(join(outside, 'loot.txt'), 'loot');
    symlinkSync(outside, join(root, 'escape'));
    expect(() => files.read('escape/loot.txt')).toThrow();
    rmSync(outside, { recursive: true, force: true });
  });
});

describe('the Garbage', () => {
  it('deleting moves the entry and notes where it came from', () => {
    files.write('reports/a.pdf', Buffer.from('a'));
    expect(files.remove('reports/a.pdf')).toBe('ok');

    const [entry] = files.listGarbage();
    expect(entry?.name).toBe('a.pdf');
    expect(entry?.originalPath).toBe('reports/a.pdf');
    expect(files.read('reports/a.pdf')).toBeUndefined();
  });

  it('two deletes of the same name never collide', () => {
    files.write('a.txt', Buffer.from('one'));
    files.remove('a.txt');
    files.write('a.txt', Buffer.from('two'));
    files.remove('a.txt');

    const names = files.listGarbage().map((entry) => entry.name);
    expect(names.sort()).toEqual(['a (2).txt', 'a.txt']);
  });

  it('restore puts the entry back where it was, recreating parents', () => {
    files.write('reports/2026/a.pdf', Buffer.from('a'));
    files.remove('reports/2026/a.pdf');
    rmSync(join(root, 'reports'), { recursive: true, force: true });

    expect(files.restore('a.pdf')).toBe('ok');
    expect(files.read('reports/2026/a.pdf')?.toString()).toBe('a');
    expect(files.listGarbage()).toHaveLength(0);
  });

  it('restore refuses to overwrite a live file with the same path', () => {
    files.write('a.txt', Buffer.from('old'));
    files.remove('a.txt');
    files.write('a.txt', Buffer.from('new'));
    expect(files.restore('a.txt')).toBe('name-taken');
    expect(files.read('a.txt')?.toString()).toBe('new');
  });

  it('a file dropped into Garbage by hand purges by mtime and restores to the root', () => {
    const stray = join(root, 'Garbage', 'stray.txt');
    writeFileSync(stray, 'stray');
    const mtime = new Date(clock.now());
    utimesSync(stray, mtime, mtime);

    const [entry] = files.listGarbage();
    expect(entry?.originalPath).toBe('stray.txt');

    expect(files.restore('stray.txt')).toBe('ok');
    expect(files.read('stray.txt')?.toString()).toBe('stray');
  });

  it('a note whose file is gone is simply not listed', () => {
    files.write('a.txt', Buffer.from('a'));
    files.remove('a.txt');
    rmSync(join(root, 'Garbage', 'a.txt'));
    expect(files.listGarbage()).toHaveLength(0);
  });

  it('a corrupt note file never blocks the trash', () => {
    files.write('a.txt', Buffer.from('a'));
    files.remove('a.txt');
    writeFileSync(join(root, 'Garbage', '.garbage.json'), 'not json at all');
    const [entry] = files.listGarbage();
    expect(entry?.name).toBe('a.txt');
    expect(entry?.originalPath).toBe('a.txt');
  });

  it('purges only what is past its thirty days', () => {
    files.write('old.txt', Buffer.from('old'));
    files.remove('old.txt');
    clock.advance(TRASH_RETENTION_MS - DAY_MS);
    files.write('fresh.txt', Buffer.from('fresh'));
    files.remove('fresh.txt');
    clock.advance(2 * DAY_MS);

    expect(files.purgeExpired()).toBe(1);
    expect(files.listGarbage().map((entry) => entry.name)).toEqual(['fresh.txt']);
  });

  it('empties the whole Garbage on demand, folders included', () => {
    files.write('a.txt', Buffer.from('a'));
    files.write('dir/b.txt', Buffer.from('b'));
    files.remove('a.txt');
    files.remove('dir');
    expect(files.emptyGarbage()).toBe(2);
    expect(files.listGarbage()).toHaveLength(0);
  });
});

describe('modifiedSince', () => {
  it('names the live files touched at or after the mark', () => {
    // mtimes are the real filesystem's, so the mark is real time too.
    files.write('before.txt', Buffer.from('x'));
    const old = new Date(Date.now() - DAY_MS);
    utimesSync(join(root, 'before.txt'), old, old);

    files.write('reports/after.pdf', Buffer.from('y'));
    expect(files.modifiedSince(Date.now() - 60_000)).toEqual(['reports/after.pdf']);
  });
});

describe('mkdir', () => {
  it('creates nested folders that list as empty dirs', () => {
    files.mkdir('a/b');
    const tree = files.tree();
    expect(tree[0]?.kind).toBe('dir');
    expect(tree[0]?.children?.[0]?.path).toBe('a/b');
  });
});
