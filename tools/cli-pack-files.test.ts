import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareCliPackDirectory, publishCliArchive } from './cli-pack-files.js';

describe('CLI pack artifact retention', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function temporaryPack(): string {
    const pack = mkdtempSync(join(tmpdir(), 'pop-cli-pack-'));
    roots.push(pack);
    return pack;
  }

  it('keeps historical immutable archives when publishing a later release', () => {
    const pack = temporaryPack();
    writeFileSync(join(pack, 'cli-0.2.0.tgz'), 'historical');
    writeFileSync(join(pack, 'stale-output'), 'remove me');

    prepareCliPackDirectory(pack);
    writeFileSync(join(pack, 'pop-agent-0.3.0.tgz'), 'current');

    expect(publishCliArchive(pack, '0.3.0')).toBe('cli-0.3.0.tgz');
    expect(readFileSync(join(pack, 'cli-0.2.0.tgz'), 'utf8')).toBe('historical');
    expect(readFileSync(join(pack, 'cli-0.3.0.tgz'), 'utf8')).toBe('current');
    expect(() => readFileSync(join(pack, 'stale-output'))).toThrow();
  });

  it('refuses to replace an immutable release with different bytes', () => {
    const pack = temporaryPack();
    writeFileSync(join(pack, 'cli-0.3.0.tgz'), 'published');
    writeFileSync(join(pack, 'pop-agent-0.3.0.tgz'), 'changed');

    expect(() => publishCliArchive(pack, '0.3.0')).toThrow('refusing to replace immutable CLI artifact');
    expect(readFileSync(join(pack, 'cli-0.3.0.tgz'), 'utf8')).toBe('published');
  });

  it('removes symlinks that imitate historical archive names', () => {
    const pack = temporaryPack();
    const outside = join(pack, 'outside');
    writeFileSync(outside, 'not an artifact');
    symlinkSync(outside, join(pack, 'cli-0.1.0.tgz'));

    prepareCliPackDirectory(pack);

    expect(() => readFileSync(join(pack, 'cli-0.1.0.tgz'))).toThrow();
  });

  it('refuses a symlinked pack directory without touching its target', () => {
    const root = temporaryPack();
    const pack = join(root, 'pack');
    writeFileSync(join(root, 'important'), 'keep');
    symlinkSync(root, pack);

    expect(() => prepareCliPackDirectory(pack)).toThrow('not a real directory');
    expect(readFileSync(join(root, 'important'), 'utf8')).toBe('keep');
  });
});
