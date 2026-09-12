import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { archiveCliReleases } from './cli-release-archive.js';

describe('durable CLI release archive', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function root(): string {
    const value = mkdtempSync(join(tmpdir(), 'pop-cli-releases-'));
    roots.push(value);
    return value;
  }

  it('retains releases across replacement of the checkout-local pack', () => {
    const base = root();
    const pack = join(base, 'pack');
    const durable = join(base, 'durable');
    archiveCliReleases(pack, durable);

    // The source can be absent on first boot, then be replaced by a clean checkout.
    mkdirSync(pack);
    writeFileSync(join(pack, 'cli-0.2.0.tgz'), 'old');
    archiveCliReleases(pack, durable);
    rmSync(pack, { recursive: true });
    mkdirSync(pack);
    writeFileSync(join(pack, 'cli-0.3.0.tgz'), 'new');
    archiveCliReleases(pack, durable);

    expect(readFileSync(join(durable, 'cli-0.2.0.tgz'), 'utf8')).toBe('old');
    expect(readFileSync(join(durable, 'cli-0.3.0.tgz'), 'utf8')).toBe('new');
  });

  it('refuses conflicting bytes for an immutable version', () => {
    const base = root();
    const pack = join(base, 'pack');
    const durable = join(base, 'durable');
    mkdirSync(pack);
    writeFileSync(join(pack, 'cli-0.2.0.tgz'), 'first');
    archiveCliReleases(pack, durable);
    writeFileSync(join(pack, 'cli-0.2.0.tgz'), 'changed');

    expect(() => archiveCliReleases(pack, durable)).toThrow('conflicting immutable CLI release');
  });
});
