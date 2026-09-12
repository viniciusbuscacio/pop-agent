import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VERSION } from './version.js';

interface PackageJson {
  version: string;
}

const readPackage = (relativePath: string): PackageJson =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as PackageJson;
describe('CLI component version', () => {
  it('keeps the bundled handshake aligned with the CLI package independently of the server', () => {
    expect(VERSION).toBe(readPackage('../package.json').version);
  });
});
