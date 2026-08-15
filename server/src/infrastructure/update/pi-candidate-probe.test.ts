import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

let root: string | undefined;
afterEach(() => { if (root !== undefined) rmSync(root, { recursive: true, force: true }); });

describe('pi candidate behavioral probe', () => {
  it('runs a fake-provider tool turn and aborts an in-flight request without tokens', async () => {
    root = mkdtempSync(join(tmpdir(), 'pop-pi-probe-test-'));
    const candidateRoot = root;
    const packageSource = join(process.cwd(), 'node_modules', '@earendil-works', 'pi-coding-agent');
    const packageTarget = join(candidateRoot, 'node_modules', '@earendil-works', 'pi-coding-agent');
    mkdirSync(join(candidateRoot, 'node_modules', '@earendil-works'), { recursive: true });
    symlinkSync(packageSource, packageTarget, 'dir');
    const version = (JSON.parse(readFileSync(join(packageSource, 'package.json'), 'utf8')) as { version: string }).version;
    const script = join(process.cwd(), 'server', 'src', 'infrastructure', 'update', 'pi-candidate-probe.ts');

    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        process.execPath,
        ['--import', 'tsx', script, candidateRoot, version],
        { timeout: 30_000 },
        (error, stdout, stderr) => error === null ? resolve(stdout) : reject(new Error(stderr || error.message)),
      );
    });

    expect(JSON.parse(output)).toEqual({ ok: true, version });
  }, 35_000);
});
