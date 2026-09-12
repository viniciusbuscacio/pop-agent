import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NoteJail, NoteJailError } from './note-jail.js';

let root: string;
let outside: string;
let jail: NoteJail;

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), 'pop-jail-'));
  root = join(base, 'notes');
  outside = join(base, 'outside');
  mkdirSync(root, { recursive: true });
  mkdirSync(outside, { recursive: true });
  jail = new NoteJail(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('NoteJail', () => {
  it('resolves an ordinary note under the vault', () => {
    expect(jail.resolve('ideas/today.md')).toBe(join(jail.rootPath, 'ideas', 'today.md'));
  });

  it('refuses a path that climbs out with ..', () => {
    expect(() => jail.resolve('../secret.md')).toThrow(NoteJailError);
    expect(() => jail.resolve('a/../../b.md')).toThrow(NoteJailError);
  });

  it('refuses an absolute path', () => {
    expect(() => jail.resolve('/etc/passwd.md')).toThrow(NoteJailError);
  });

  it('refuses anything that is not markdown', () => {
    expect(() => jail.resolve('notes.txt')).toThrow(NoteJailError);
    expect(() => jail.resolve('secret.key')).toThrow(NoteJailError);
  });

  it('refuses dotfiles and dot segments', () => {
    expect(() => jail.resolve('.env.md')).toThrow(NoteJailError);
    expect(() => jail.resolve('.hidden/note.md')).toThrow(NoteJailError);
  });

  it('refuses a null byte', () => {
    expect(() => jail.resolve('note\0.md')).toThrow(NoteJailError);
  });

  it('follows a symlink and refuses it when it points out of the vault', () => {
    writeFileSync(join(outside, 'target.md'), 'secret');
    symlinkSync(join(outside, 'target.md'), join(root, 'link.md'));

    expect(() => jail.resolve('link.md')).toThrow(NoteJailError);
  });

  it('allows a not-yet-existing note (a write)', () => {
    expect(jail.resolve('new/thought.md')).toBe(join(jail.rootPath, 'new', 'thought.md'));
  });
});
