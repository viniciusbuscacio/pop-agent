import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, posix, relative } from 'node:path';

export const RUNTIME_PATHS = ['node_modules', 'server/node_modules', 'shared/node_modules', 'cli/node_modules', 'web/node_modules', 'shared/dist', 'server/dist', 'web/dist', 'cli/pack'];

export interface RuntimeManifest {
  schema: 1;
  version: string;
  commit: string;
  tree: string;
  platform: 'linux';
  architecture: string;
  node: string;
  glibc: string;
  gateCompletedAt: string;
  file: string;
  size: number;
  sha256: string;
}

export function git(root: string, args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export async function fileHash(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes as Buffer);
  return hash.digest('hex');
}

export function glibcVersion(): string {
  const report = process.report.getReport() as { header: { glibcVersionRuntime?: string } };
  const version = report.header.glibcVersionRuntime;
  if (version === undefined) throw new Error('Prebuilt server releases require Linux with glibc');
  return version;
}

export function validateManifest(value: unknown, expected: { version: string; commit: string; tree: string; node: string; architecture: string; glibc: string }): RuntimeManifest {
  const m = value as Partial<RuntimeManifest> | null;
  if (m === null || typeof m !== 'object' || m.schema !== 1 || m.platform !== 'linux'
    || m.version !== expected.version || m.commit !== expected.commit || m.tree !== expected.tree
    || m.node !== expected.node || m.architecture !== expected.architecture
    || !/^[a-f0-9]{40}$/.test(m.commit) || !/^[a-f0-9]{40}$/.test(m.tree)
    || typeof m.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(m.sha256)
    || typeof m.size !== 'number' || !Number.isSafeInteger(m.size) || m.size <= 0 || m.size > 2_000_000_000
    || m.file !== `pop-agent-${expected.version}-linux-${expected.architecture}.tar.gz`
    || typeof m.gateCompletedAt !== 'string' || !Number.isFinite(Date.parse(m.gateCompletedAt))
    || typeof m.glibc !== 'string' || !/^\d+\.\d+$/.test(m.glibc)) {
    throw new Error('Server release manifest does not match this exact checkout, Node runtime, or architecture');
  }
  const [major, minor] = expected.glibc.split('.').map(Number);
  const [requiredMajor, requiredMinor] = m.glibc.split('.').map(Number);
  if (major! < requiredMajor! || (major === requiredMajor && minor! < requiredMinor!)) {
    throw new Error(`This release requires glibc ${m.glibc} or newer; found ${expected.glibc}`);
  }
  return m as RuntimeManifest;
}

export function validateArchiveListing(names: string[], verbose: string[]): void {
  const unsafeCharacters = (value: string) => value.includes('\\') || [...value].some((character) => character.codePointAt(0)! < 32 || character.codePointAt(0) === 127);
  if (names.length === 0 || names.length !== verbose.length) throw new Error('Invalid server archive listing');
  const links: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    const name = names[i]!.replace(/\/$/, '');
    if (name.startsWith('/') || name.split('/').includes('..') || unsafeCharacters(name)
      || !RUNTIME_PATHS.some((root) => name === root || name.startsWith(`${root}/`)) || seen.has(name)) {
      throw new Error(`Unsafe or duplicate server archive path: ${name}`);
    }
    seen.add(name);
    const type = verbose[i]![0];
    if (type !== '-' && type !== 'd' && type !== 'l') throw new Error('Server archive contains a hard link or special entry');
    if (type === 'l') {
      const target = verbose[i]!.split(' -> ')[1];
      if (!target || isAbsolute(target) || unsafeCharacters(target)) throw new Error('Unsafe server archive link');
      const resolved = posix.normalize(posix.join(posix.dirname(name), target));
      if (resolved === '..' || resolved.startsWith('../')) throw new Error('Server archive link escapes release');
      links.push(name);
    }
  }
  for (const link of links) {
    if (names.some((name) => name.startsWith(`${link}/`))) throw new Error('Server archive writes through a symlink');
  }
}

export function extractRuntime(archive: string, destination: string): void {
  const listing = (flag: string) => execFileSync('tar', ['--quoting-style=literal', flag, archive], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  }).trimEnd().split('\n');
  validateArchiveListing(listing('-tzf'), listing('-tvzf'));
  execFileSync('tar', ['--no-same-owner', '--no-same-permissions', '-xzf', archive, '-C', destination]);
  for (const path of RUNTIME_PATHS) {
    try { lstatSync(join(destination, path)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    validateTree(join(destination, path), destination);
  }
}

export function validateTree(path: string, root: string): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) {
    const target = realpathSync(path);
    const difference = relative(root, target);
    if (difference === '..' || difference.startsWith('../') || isAbsolute(difference)) throw new Error(`Escaping release symlink: ${path}`);
  } else if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) validateTree(join(path, entry), root);
  } else if (!stat.isFile()) throw new Error(`Special entry in release: ${path}`);
}

export async function checkNativeRuntime(root: string): Promise<void> {
  // Load actual native code, not just package.json metadata. No model download or provider request.
  const script = `
    import { createRequire } from 'node:module';
    const require = createRequire(process.cwd() + '/package.json');
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    if (db.prepare('select 42 as value').get().value !== 42) throw Error('SQLite probe failed');
    db.close();
    const argon2 = require('argon2');
    const hash = await argon2.hash('local-install-probe');
    if (!await argon2.verify(hash, 'local-install-probe')) throw Error('Argon2 probe failed');
    await require('sharp')({create:{width:1,height:1,channels:3,background:'white'}}).png().toBuffer();
    await import('@huggingface/transformers');
    await import('@earendil-works/pi-coding-agent');
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: join(root, 'server'), timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PI_OFFLINE: '1' },
  });
  for (const file of ['server/dist/main.js', 'server/dist/manager/main.js', 'web/dist/index.html', 'cli/pack/runtime/node/manifest.json']) {
    if (!lstatSync(join(root, file)).isFile()) throw new Error(`Missing runtime file: ${file}`);
  }
  for (const directory of ['cli/pack/launcher', 'cli/pack/local-access', 'cli/pack/runtime/node']) {
    const manifest = JSON.parse(readFileSync(join(root, directory, 'manifest.json'), 'utf8')) as { artifacts?: Record<string, { file: string; size: number; sha256: string }>; packages?: Record<string, { file: string; size: number; sha256: string }> };
    const artifacts = Object.values(manifest.artifacts ?? manifest.packages ?? {});
    if (artifacts.length === 0) throw new Error(`Empty client manifest: ${directory}`);
    for (const artifact of artifacts) {
      if (typeof artifact.file !== 'string' || artifact.file.includes('/') || artifact.file.includes('\\') || artifact.file === '..') throw new Error('Invalid client artifact filename');
      const path = join(root, directory, artifact.file);
      if (!lstatSync(path).isFile() || lstatSync(path).size !== artifact.size || await fileHash(path) !== artifact.sha256) throw new Error(`Client artifact failed verification: ${artifact.file}`);
    }
  }
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  if (!lstatSync(join(root, `cli/pack/cli-${version}.tgz`)).isFile()) throw new Error('Missing packed CLI');
}
