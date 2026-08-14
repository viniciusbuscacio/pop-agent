import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { versionConsistencyErrors } from './check-version-consistency.js';

const sourceRoot = join(import.meta.dirname, '..');
const fixtures = [
  'VERSION',
  'package.json',
  'package-lock.json',
  'shared/package.json',
  'server/package.json',
  'web/package.json',
  'cli/package.json',
  'tools/package.json',
  'cli/src/version.ts',
  'desktop/native/VERSION',
] as const;

let root = '';

afterEach(() => {
  if (root !== '') rmSync(root, { recursive: true, force: true });
  root = '';
});

function fixture(): string {
  root = mkdtempSync(join(tmpdir(), 'pop-version-lock-'));
  for (const relative of fixtures) {
    const destination = join(root, relative);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(sourceRoot, relative), destination);
  }
  return root;
}

describe('global version consistency', () => {
  it('accepts the checked-in release version everywhere', () => {
    expect(versionConsistencyErrors(sourceRoot)).toEqual([]);
  });

  it('reports package, lockfile, CLI and desktop release drift together', () => {
    const target = fixture();
    const cliPath = join(target, 'cli/src/version.ts');
    writeFileSync(cliPath, readFileSync(cliPath, 'utf8').replace('0.2.26', '0.2.9'));

    const rootPackagePath = join(target, 'package.json');
    const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8')) as { version: string };
    rootPackage.version = '0.2.9';
    writeFileSync(rootPackagePath, `${JSON.stringify(rootPackage)}\n`);

    const lockPath = join(target, 'package-lock.json');
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    lock.packages['cli']!.version = '0.2.9';
    writeFileSync(lockPath, `${JSON.stringify(lock)}\n`);

    writeFileSync(join(target, 'desktop/native/VERSION'), '0.2.8\n');

    mkdirSync(join(target, 'desktop/pack'), { recursive: true });
    writeFileSync(
      join(target, 'desktop/pack/release.json'),
      JSON.stringify({ version: '0.2.7', file: 'pop-desktop-0.2.7-darwin-arm64.zip' }),
      { flag: 'w' },
    );

    expect(versionConsistencyErrors(target)).toEqual(expect.arrayContaining([
      'package.json version is "0.2.9"; expected 0.2.26',
      'package-lock.json packages["cli"] version is "0.2.9"; expected 0.2.26',
      'cli/src/version.ts VERSION is "0.2.9"; expected 0.2.26',
      'desktop/native/VERSION is "0.2.8"; expected 0.2.26',
      'desktop/pack/release.json version is "0.2.7"; expected 0.2.26',
      'desktop/pack/release.json file is "pop-desktop-0.2.7-darwin-arm64.zip"; expected pop-desktop-0.2.26-darwin-arm64.zip',
    ]));
  });
});
