import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

interface PackageJson {
  name?: string;
  version?: string;
}

interface PackageLock {
  version?: string;
  packages?: Record<string, PackageJson>;
}

const packagePaths = [
  'package.json',
  'shared/package.json',
  'server/package.json',
  'web/package.json',
  'tools/package.json',
] as const;

const lockPackagePaths = ['', 'shared', 'server', 'web'] as const;
const semanticVersion = /^\d+\.\d+\.\d+$/;

export function versionConsistencyErrors(root: string): string[] {
  const errors: string[] = [];
  const version = readText(join(root, 'VERSION'));
  if (!semanticVersion.test(version)) {
    errors.push(`VERSION is ${JSON.stringify(version)}; expected X.Y.Z`);
    return errors;
  }

  for (const relative of packagePaths) {
    const manifest = readJson<PackageJson>(root, relative, errors);
    if (manifest !== undefined && manifest.version !== version) {
      errors.push(`${relative} version is ${JSON.stringify(manifest.version)}; expected ${version}`);
    }
  }

  const lock = readJson<PackageLock>(root, 'package-lock.json', errors);
  if (lock !== undefined) {
    if (lock.version !== version) {
      errors.push(`package-lock.json version is ${JSON.stringify(lock.version)}; expected ${version}`);
    }
    for (const relative of lockPackagePaths) {
      const entry = lock.packages?.[relative];
      const label = relative === '' ? '<root>' : relative;
      if (entry?.version !== version) {
        errors.push(`package-lock.json packages[${JSON.stringify(label)}] version is ${JSON.stringify(entry?.version)}; expected ${version}`);
      }
    }
  }

  const cliPackage = readJson<PackageJson>(root, 'cli/package.json', errors);
  const expectedCli = cliPackage?.version;
  if (!semanticVersion.test(expectedCli ?? '')) errors.push('Invalid CLI component version');
  if (lock?.packages?.['cli']?.version !== expectedCli) errors.push('CLI lockfile version differs from cli/package.json');

  const cliVersionPath = join(root, 'cli/src/version.ts');
  const cliSource = readText(cliVersionPath);
  const cliVersion = /export const VERSION = ['"]([^'"]+)['"]/.exec(cliSource)?.[1];
  if (cliVersion !== expectedCli) {
    errors.push(`cli/src/version.ts VERSION is ${JSON.stringify(cliVersion)}; expected ${expectedCli}`);
  }

  const traySource = readText(join(root, 'local-access/tray/main.go'));
  const trayVersion = /const trayVersion = "([^"]+)"/.exec(traySource)?.[1];
  if (!semanticVersion.test(trayVersion ?? '')) {
    errors.push(`local-access/tray/main.go trayVersion is ${JSON.stringify(trayVersion)}; expected an independent semantic version`);
  }

  // Packed artifacts are immutable release snapshots and may trail the server.
  // Their own versions stay valid; a source release must not relabel an old tgz.
  const packedCliManifest = join(root, 'cli/pack/package.json');
  if (existsSync(packedCliManifest)) {
    const packed = readJson<PackageJson>(root, 'cli/pack/package.json', errors);
    if (packed !== undefined && !semanticVersion.test(packed.version ?? '')) {
      errors.push(`cli/pack/package.json version is ${JSON.stringify(packed.version)}; expected X.Y.Z`);
    }
  }

  return errors;
}

export function assertVersionConsistency(root: string): void {
  const errors = versionConsistencyErrors(root);
  if (errors.length > 0) {
    throw new Error(`Global version consistency check failed:\n- ${errors.join('\n- ')}`);
  }
}

function readJson<T>(root: string, relative: string, errors: string[]): T | undefined {
  try {
    return JSON.parse(readFileSync(join(root, relative), 'utf8')) as T;
  } catch (error) {
    errors.push(`${relative} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  try {
    assertVersionConsistency(root);
    console.log(`Version consistency passed (${readText(join(root, 'VERSION'))})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
