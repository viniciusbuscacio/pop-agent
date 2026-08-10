import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version.js';

interface PackageJson {
  version: string;
}

const readPackage = (relativePath: string): PackageJson =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as PackageJson;

describe('release version', () => {
  it('keeps every package and the bundled CLI handshake on one version', () => {
    const root = readPackage('../../package.json').version;
    const versions = [
      root,
      readPackage('../package.json').version,
      readPackage('../../shared/package.json').version,
      readPackage('../../server/package.json').version,
      readPackage('../../web/package.json').version,
      readPackage('../../tools/package.json').version,
      VERSION,
    ];

    expect(new Set(versions)).toEqual(new Set([root]));
  });
});
