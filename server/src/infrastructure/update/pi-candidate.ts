import { execFile } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  PiCandidateInstaller,
  PiCandidateStateStore,
  PiCandidateStatus,
} from '../../application/ports/pi-candidate.js';

const PI_PACKAGE = '@earendil-works/pi-coding-agent';
const EXACT_VERSION = /^\d+\.\d+\.\d+$/;
const REGISTRY = 'https://registry.npmjs.org';
const INSTALL_TIMEOUT_MS = 120_000;
const PROBE_TIMEOUT_MS = 30_000;

export class JsonPiCandidateStateStore implements PiCandidateStateStore {
  constructor(readonly path: string) {}

  read(): PiCandidateStatus | undefined {
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8')) as PiCandidateStatus;
      return typeof value.phase === 'string' ? value : undefined;
    } catch {
      return undefined;
    }
  }

  write(status: PiCandidateStatus): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

/** npm is confined to a versioned runtime root; lifecycle scripts never run. */
export class NpmPiCandidateInstaller implements PiCandidateInstaller {
  constructor(
    private readonly deps: {
      root: string;
      probeScript: string;
      npm?: string;
      node?: string;
      run?: typeof run;
    },
  ) {}

  async prepare(version: string, onValidating: () => void): Promise<{ version: string; integrity: string }> {
    if (!EXACT_VERSION.test(version)) throw new Error('pi candidate must be an exact stable version');
    const versionsDir = join(this.deps.root, 'versions');
    const finalDir = join(versionsDir, version);
    const existing = metadata(finalDir);
    if (existing?.version === version && existing.integrity.length > 0) return existing;

    mkdirSync(join(this.deps.root, 'staging'), { recursive: true, mode: 0o700 });
    mkdirSync(versionsDir, { recursive: true, mode: 0o700 });
    const staging = mkdtempSync(join(this.deps.root, 'staging', `${version}-`));
    const execute = this.deps.run ?? run;
    try {
      writeFileSync(
        join(staging, 'package.json'),
        `${JSON.stringify({ private: true, dependencies: { [PI_PACKAGE]: version } }, null, 2)}\n`,
        { mode: 0o600 },
      );
      await execute(this.deps.npm ?? 'npm', [
        'install',
        '--prefix', staging,
        '--omit=dev',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        '--package-lock=true',
        '--registry', REGISTRY,
      ], INSTALL_TIMEOUT_MS);

      const lock = JSON.parse(readFileSync(join(staging, 'package-lock.json'), 'utf8')) as {
        packages?: Record<string, { integrity?: string; version?: string }>;
      };
      const installed = lock.packages?.[`node_modules/${PI_PACKAGE}`];
      if (installed?.version !== version || installed.integrity === undefined) {
        throw new Error('npm installed a pi package that did not match the candidate');
      }

      onValidating();
      await execute(this.deps.node ?? process.execPath, [
        this.deps.probeScript,
        staging,
        version,
      ], PROBE_TIMEOUT_MS);

      const result = { version, integrity: installed.integrity };
      writeFileSync(join(staging, 'candidate.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
      rmSync(finalDir, { recursive: true, force: true });
      renameSync(staging, finalDir);
      return result;
    } catch (error) {
      rmSync(staging, { recursive: true, force: true });
      throw error;
    }
  }
}

function metadata(root: string): { version: string; integrity: string } | undefined {
  try {
    const value = JSON.parse(readFileSync(join(root, 'candidate.json'), 'utf8')) as {
      version?: string;
      integrity?: string;
    };
    return typeof value.version === 'string' && typeof value.integrity === 'string'
      ? { version: value.version, integrity: value.integrity }
      : undefined;
  } catch {
    return undefined;
  }
}

function run(command: string, args: string[], timeout: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 2 * 1024 * 1024 }, (error) => {
      if (error === null) resolve();
      else reject(new Error(`pi candidate command failed (${command})`));
    });
  });
}
