import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NpmPiCandidateInstaller } from './pi-candidate.js';

let root: string | undefined;
afterEach(() => { if (root !== undefined) rmSync(root, { recursive: true, force: true }); });

describe('npm pi candidate installer', () => {
  it('installs with scripts disabled, validates, and atomically records integrity', async () => {
    root = mkdtempSync(join(tmpdir(), 'pop-pi-stage-'));
    const run = vi.fn(async (command: string, args: string[]) => {
      if (command !== 'npm') return;
      const prefix = args[args.indexOf('--prefix') + 1];
      if (prefix === undefined) throw new Error('prefix missing');
      mkdirSync(join(prefix, 'node_modules', '@earendil-works', 'pi-coding-agent'), { recursive: true });
      writeFileSync(join(prefix, 'package-lock.json'), JSON.stringify({
        packages: {
          'node_modules/@earendil-works/pi-coding-agent': {
            version: '0.85.0', integrity: 'sha512-candidate',
          },
        },
      }));
    });
    const installer = new NpmPiCandidateInstaller({ root, probeScript: '/probe.js', run });
    const validating = vi.fn();

    await expect(installer.prepare('0.85.0', validating)).resolves.toEqual({
      version: '0.85.0', integrity: 'sha512-candidate',
    });
    expect(validating).toHaveBeenCalledOnce();
    expect(run.mock.calls[0]?.[1]).toContain('--ignore-scripts');
    expect(run.mock.calls[1]?.slice(0, 2)).toEqual([process.execPath, ['/probe.js', expect.any(String), '0.85.0']]);
    expect(JSON.parse(readFileSync(join(root, 'versions', '0.85.0', 'candidate.json'), 'utf8'))).toEqual({
      version: '0.85.0', integrity: 'sha512-candidate',
    });
  });

  it('rejects ranges before invoking npm', async () => {
    root = mkdtempSync(join(tmpdir(), 'pop-pi-stage-'));
    const run = vi.fn();
    const installer = new NpmPiCandidateInstaller({ root, probeScript: '/probe.js', run });
    await expect(installer.prepare('^0.85.0', vi.fn())).rejects.toThrow('exact stable version');
    expect(run).not.toHaveBeenCalled();
  });
});
