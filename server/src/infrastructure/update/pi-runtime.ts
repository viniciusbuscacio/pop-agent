import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

export interface ActivePiRuntime {
  version: string;
  source: 'bundled' | 'isolated';
  sdkEntry?: string;
}

export interface PiRuntimePointer {
  version: string;
  integrity: string;
  activatedAt: string;
}

/** Resolve an explicit pointer strictly: a bad activation must fail boot and trigger rollback. */
export function resolveActivePiRuntime(root: string, bundledVersion: string): ActivePiRuntime {
  const pointerPath = join(root, 'active.json');
  let pointer: PiRuntimePointer;
  try {
    pointer = JSON.parse(readFileSync(pointerPath, 'utf8')) as PiRuntimePointer;
  } catch (error) {
    if (!existsSync(pointerPath)) return { version: bundledVersion, source: 'bundled' };
    throw new Error(`active pi runtime pointer is unreadable: ${messageOf(error)}`);
  }
  if (!EXACT_VERSION.test(pointer.version) || pointer.integrity.length === 0) {
    throw new Error('active pi runtime pointer is invalid');
  }
  const candidateRoot = join(root, 'versions', pointer.version);
  const candidate = JSON.parse(readFileSync(join(candidateRoot, 'candidate.json'), 'utf8')) as PiRuntimePointer;
  if (candidate.version !== pointer.version || candidate.integrity !== pointer.integrity) {
    throw new Error('active pi runtime no longer matches its validated candidate');
  }
  const packageRoot = join(candidateRoot, 'node_modules', '@earendil-works', 'pi-coding-agent');
  const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
    version?: string;
    exports?: { '.'?: { import?: string } | string };
  };
  const exported = packageJson.exports?.['.'];
  const relativeEntry = typeof exported === 'string' ? exported : exported?.import;
  if (packageJson.version !== pointer.version || relativeEntry === undefined) {
    throw new Error('active pi runtime package metadata is invalid');
  }
  const entry = join(packageRoot, relativeEntry);
  if (!existsSync(entry)) throw new Error('active pi runtime entry is missing');
  return { version: pointer.version, source: 'isolated', sdkEntry: pathToFileURL(entry).href };
}

/** Import before HTTP health can answer, then leave an external-supervisor proof. */
export async function validateAndStampPiRuntime(
  runtime: ActivePiRuntime,
  bootPath: string,
): Promise<void> {
  const sdk = runtime.sdkEntry === undefined
    ? await import('@earendil-works/pi-coding-agent')
    : await import(runtime.sdkEntry) as typeof import('@earendil-works/pi-coding-agent');
  if (typeof sdk.createAgentSession !== 'function' || typeof sdk.ModelRuntime?.create !== 'function') {
    throw new Error('active pi runtime failed its boot contract');
  }
  mkdirSync(dirname(bootPath), { recursive: true, mode: 0o700 });
  const record = {
    version: runtime.version,
    source: runtime.source,
    pid: process.pid,
    bootedAt: new Date().toISOString(),
  };
  const temporary = `${bootPath}.${String(process.pid)}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, bootPath);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
