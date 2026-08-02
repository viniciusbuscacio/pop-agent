import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotesVault } from './notes-vault.js';

let root: string;
let vault: NotesVault;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'popy-vault-'));
  vault = new NotesVault(join(root, 'notes'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('NotesVault', () => {
  it('writes a note, then reads it back and lists it', () => {
    const saved = vault.write('groceries/week.md', '- milk\n- coffee');

    expect(saved).toBe('groceries/week.md');
    expect(vault.read('groceries/week.md')).toBe('- milk\n- coffee');
    expect(vault.list()).toEqual(['groceries/week.md']);
    expect(vault.count()).toBe(1);
  });

  it('appends to a note without touching what was already there', () => {
    vault.write('log.md', '# Log\n\n## one\n');

    const saved = vault.append('log.md', '\n## two\n');

    expect(saved).toBe('log.md');
    expect(vault.read('log.md')).toBe('# Log\n\n## one\n\n## two\n');
  });

  it('appends to a note that does not exist yet, creating folders', () => {
    const saved = vault.append('journal/2026.md', 'first line');

    expect(saved).toBe('journal/2026.md');
    expect(vault.read('journal/2026.md')).toBe('first line');
    expect(vault.list()).toEqual(['journal/2026.md']);
  });

  it('starts the appended text on its own line when the note has no trailing newline', () => {
    vault.write('a.md', 'no newline at the end');

    vault.append('a.md', '## next');

    expect(vault.read('a.md')).toBe('no newline at the end\n## next');
  });

  it('appends to a note bigger than the read cap without truncating it', () => {
    // read() caps at 64 KiB; a read-then-write append would save the truncated
    // copy and delete the rest. Appending must not.
    vault.write('big.md', `${'x'.repeat(100 * 1024)}\n`);

    vault.append('big.md', 'tail');

    expect(statSync(join(root, 'notes', 'big.md')).size).toBe(100 * 1024 + 1 + 4);
  });

  it('refuses to append outside the vault', () => {
    expect(() => vault.append('../../etc/passwd.md', 'nope')).toThrow();
  });

  it('searches across notes and returns matching lines', () => {
    vault.write('a.md', 'buy milk\nand bread');
    vault.write('b.md', 'call the plumber');

    const hits = vault.search('milk');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: 'a.md', line: 1, text: 'buy milk' });
  });

  it('caps a huge note on read', () => {
    vault.write('big.md', 'x'.repeat(100 * 1024));
    expect(vault.read('big.md').endsWith('…[truncated]')).toBe(true);
  });

  it('refuses to read outside the vault', () => {
    expect(() => vault.read('../../etc/passwd.md')).toThrow();
  });
});
