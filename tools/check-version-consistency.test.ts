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
  'local-access/tray/main.go',
] as const;

const releaseVersion = readFileSync(join(sourceRoot, 'VERSION'), 'utf8').trim();
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

  it('reports source drift across manifests, lockfile and the CLI handshake', () => {
    const target = fixture();
    const cliPath = join(target, 'cli/src/version.ts');
    writeFileSync(cliPath, readFileSync(cliPath, 'utf8').replace(releaseVersion, '0.2.9'));

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

    expect(versionConsistencyErrors(target)).toEqual(expect.arrayContaining([
      `package.json version is "0.2.9"; expected ${releaseVersion}`,
      `package-lock.json packages["cli"] version is "0.2.9"; expected ${releaseVersion}`,
      `cli/src/version.ts VERSION is "0.2.9"; expected ${releaseVersion}`,
    ]));
  });
});
