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

interface DesktopRelease {
  version?: string;
  file?: string;
}

const packagePaths = [
  'package.json',
  'shared/package.json',
  'server/package.json',
  'web/package.json',
  'cli/package.json',
  'tools/package.json',
] as const;

const lockPackagePaths = ['', 'shared', 'server', 'web', 'cli'] as const;
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

  const cliVersionPath = join(root, 'cli/src/version.ts');
  const cliSource = readText(cliVersionPath);
  const cliVersion = /export const VERSION = ['"]([^'"]+)['"]/.exec(cliSource)?.[1];
  if (cliVersion !== version) {
    errors.push(`cli/src/version.ts VERSION is ${JSON.stringify(cliVersion)}; expected ${version}`);
  }

  const packedCliManifest = join(root, 'cli/pack/package.json');
  if (existsSync(packedCliManifest)) {
    const packed = readJson<PackageJson>(root, 'cli/pack/package.json', errors);
    if (packed !== undefined && packed.version !== version) {
      errors.push(`cli/pack/package.json version is ${JSON.stringify(packed.version)}; expected ${version}`);
    }
  }

  const desktopNativeVersionPath = join(root, 'desktop/native/VERSION');
  if (existsSync(desktopNativeVersionPath)) {
    const desktopNativeVersion = readText(desktopNativeVersionPath);
    if (desktopNativeVersion !== version) {
      errors.push(`desktop/native/VERSION is ${JSON.stringify(desktopNativeVersion)}; expected ${version}`);
    }
  }

  checkDesktopRelease(root, 'desktop/pack/release.json', `pop-desktop-${version}-darwin-arm64.zip`, version, errors);
  checkDesktopRelease(
    root,
    'desktop/pack/setup-release.json',
    `pop-desktop-setup-${version}-darwin-arm64.dmg`,
    version,
    errors,
  );

  return errors;
}

function checkDesktopRelease(
  root: string,
  relative: string,
  expectedFile: string,
  version: string,
  errors: string[],
): void {
  if (!existsSync(join(root, relative))) return;
  const release = readJson<DesktopRelease>(root, relative, errors);
  if (release === undefined) return;
  if (release.version !== version) {
    errors.push(`${relative} version is ${JSON.stringify(release.version)}; expected ${version}`);
  }
  if (release.file !== expectedFile) {
    errors.push(`${relative} file is ${JSON.stringify(release.file)}; expected ${expectedFile}`);
  }
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
