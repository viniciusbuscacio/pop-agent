import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

export interface PackServerReleaseOptions {
  repository: string;
  outputDir: string;
}

export interface PackedServerRelease {
  releaseDirectory: string;
  bundlePath: string;
  sha256Path: string;
  version: string;
  commit: string;
  bundleSha256: string;
}

function usage(): never {
  throw new Error('usage: pack-server-release --output-dir PATH [--repository PATH]');
}

function parseOptions(argv: string[]): PackServerReleaseOptions {
  let repository = process.cwd();
  let outputDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === '--repository' || flag === '--output-dir') {
      if (value === undefined || value.startsWith('--')) usage();
      if (flag === '--repository') repository = value;
      if (flag === '--output-dir') outputDir = value;
      index += 1;
      continue;
    }
    usage();
  }
  if (outputDir === undefined) usage();
  return { repository: resolve(repository), outputDir: resolve(outputDir) };
}

function git(repository: string, args: string[]): string {
  return execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8' }).trim();
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function packageVersion(repository: string): string {
  const version = readFileSync(join(repository, 'VERSION'), 'utf8').trim();
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`VERSION is not a supported semantic version: ${version}`);
  }
  for (const path of [
    'package.json',
    'package-lock.json',
    'shared/package.json',
    'server/package.json',
    'web/package.json',
    'cli/package.json',
  ]) {
    const parsed = JSON.parse(readFileSync(join(repository, path), 'utf8')) as { version?: unknown };
    if (parsed.version !== version) throw new Error(`${path} version does not match VERSION`);
  }
  return version;
}

function isWithin(parent: string, candidate: string): boolean {
  const difference = relative(parent, candidate);
  return difference === '' || (!difference.startsWith('..') && !isAbsolute(difference));
}

function compareRelease(existingDirectory: string, expected: Map<string, Buffer>): void {
  if (!lstatSync(existingDirectory).isDirectory()) {
    throw new Error(`refusing to use a non-directory or symlink release path: ${existingDirectory}`);
  }
  const actualNames = readdirSync(existingDirectory).sort();
  const expectedNames = [...expected.keys()].sort();
  if (actualNames.join('\n') !== expectedNames.join('\n')) {
    throw new Error(`refusing to replace incomplete or unexpected existing release: ${existingDirectory}`);
  }
  for (const [name, bytes] of expected) {
    const path = join(existingDirectory, name);
    if (!lstatSync(path).isFile() || !readFileSync(path).equals(bytes)) {
      throw new Error(`refusing to overwrite versioned artifact with different bytes: ${name}`);
    }
  }
}

export function packServerRelease(options: PackServerReleaseOptions): PackedServerRelease {
  const repository = resolve(options.repository);
  const outputDir = resolve(options.outputDir);
  const topLevel = resolve(git(repository, ['rev-parse', '--show-toplevel']));
  if (topLevel !== repository) throw new Error(`repository must name the Git worktree root: ${topLevel}`);
  if (isWithin(repository, outputDir)) throw new Error('release output directory must be outside the source checkout');
  if (git(repository, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
    throw new Error('refusing to pack: Git worktree is not clean');
  }

  const commit = git(repository, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('HEAD did not resolve to a full lowercase commit ID');
  const version = packageVersion(repository);
  const releaseName = `pop-agent-${version}-${commit}`;
  const bundleName = `${releaseName}.bundle`;
  const shaName = `${bundleName}.sha256`;
  const releaseDirectory = join(outputDir, releaseName);

  mkdirSync(outputDir, { recursive: true });
  const staging = mkdtempSync(join(outputDir, '.staging-pop-agent-'));
  try {
    const stagedBundle = join(staging, bundleName);
    execFileSync('git', ['-C', repository, 'bundle', 'create', stagedBundle, 'HEAD'], { stdio: 'pipe' });
    execFileSync('git', ['-C', repository, 'bundle', 'verify', stagedBundle], { stdio: 'pipe' });
    const bundle = readFileSync(stagedBundle);
    const bundleSha256 = sha256(bundle);
    const shaFile = Buffer.from(`${bundleSha256}  ${bundleName}\n`, 'utf8');
    writeFileSync(join(staging, shaName), shaFile, { flag: 'wx', mode: 0o644 });
    const expected = new Map<string, Buffer>([[bundleName, bundle], [shaName, shaFile]]);

    if (existsSync(releaseDirectory)) {
      compareRelease(releaseDirectory, expected);
    } else {
      renameSync(staging, releaseDirectory);
    }

    return {
      releaseDirectory,
      bundlePath: join(releaseDirectory, bundleName),
      sha256Path: join(releaseDirectory, shaName),
      version,
      commit,
      bundleSha256,
    };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  try {
    const result = packServerRelease(parseOptions(process.argv.slice(2)));
    process.stdout.write(`bundle=${result.bundlePath}\n`);
    process.stdout.write(`sha256=${result.bundleSha256}\n`);
    process.stdout.write(`commit=${result.commit}\n`);
    process.stdout.write(`version=${result.version}\n`);
  } catch (error) {
    process.stderr.write(`pack-server-release: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
