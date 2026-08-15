import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveActivePiRuntime, validateAndStampPiRuntime } from './pi-runtime.js';

let root: string | undefined;
afterEach(() => { if (root !== undefined) rmSync(root, { recursive: true, force: true }); });

function candidate(version = '0.85.0'): { runtimeRoot: string; entry: string } {
  root = mkdtempSync(join(tmpdir(), 'pop-pi-runtime-'));
  const runtimeRoot = join(root, 'pi-runtime');
  const packageRoot = join(runtimeRoot, 'versions', version, 'node_modules', '@earendil-works', 'pi-coding-agent');
  mkdirSync(join(packageRoot, 'dist'), { recursive: true });
  writeFileSync(join(runtimeRoot, 'active.json'), JSON.stringify({ version, integrity: 'sha512-ok', activatedAt: 'now' }));
  writeFileSync(join(runtimeRoot, 'versions', version, 'candidate.json'), JSON.stringify({ version, integrity: 'sha512-ok' }));
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ version, exports: { '.': { import: './dist/index.js' } } }));
  const entry = join(packageRoot, 'dist', 'index.js');
  writeFileSync(entry, 'export const createAgentSession = () => {}; export class ModelRuntime { static create() {} }\n');
  return { runtimeRoot, entry };
}

describe('active pi runtime', () => {
  it('uses bundled pi when no activation pointer exists', () => {
    root = mkdtempSync(join(tmpdir(), 'pop-pi-runtime-'));
    expect(resolveActivePiRuntime(join(root, 'pi-runtime'), '0.84.1')).toEqual({
      version: '0.84.1', source: 'bundled',
    });
  });

  it('strictly resolves, imports, and stamps a validated isolated candidate', async () => {
    const fixture = candidate();
    const runtime = resolveActivePiRuntime(fixture.runtimeRoot, '0.84.1');
    expect(runtime).toMatchObject({ version: '0.85.0', source: 'isolated' });
    const bootPath = join(fixture.runtimeRoot, 'boot.json');
    await validateAndStampPiRuntime(runtime, bootPath);
    expect(JSON.parse(readFileSync(bootPath, 'utf8'))).toMatchObject({ version: '0.85.0', source: 'isolated' });
  });

  it('fails boot instead of silently falling back from a tampered candidate', () => {
    const fixture = candidate();
    writeFileSync(join(fixture.runtimeRoot, 'versions', '0.85.0', 'candidate.json'), JSON.stringify({
      version: '0.85.0', integrity: 'different',
    }));
    expect(() => resolveActivePiRuntime(fixture.runtimeRoot, '0.84.1')).toThrow(/no longer matches/);
  });
});
