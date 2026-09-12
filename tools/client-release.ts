import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileHash, git } from './server-runtime.ts';

interface Entry { file: string; size: number; sha256: string }
interface Lock {
  schema: 1;
  source: { repository: string; version: string; commit: string; tree: string; verifiedAt: string; archive: Entry };
  inputs: string;
  cliVersion: string;
  sources?: Record<string, { repository: string; version: string }>;
  files: Record<string, Entry>;
}
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const semver = /^\d+\.\d+\.\d+$/;
const safeFile = /^[\w.-]+$/;
const inputPaths = ['cli/src', 'cli/package.json', 'shared/src', 'launcher', 'local-access'];

/** Conservative compatibility proof: unchanged client code, wire DTOs and client dependency closure. */
export function clientInputs(root: string, revision = 'HEAD'): string {
  const files = git(root, ['ls-tree', '-r', '--name-only', revision, '--', ...inputPaths]).split('\n').filter((file) => file !== '' && !/\.test\.tsx?$|_test\.go$/.test(file));
  const read = (path: string) => execFileSync('git', ['show', `${revision}:${path}`], { cwd: root });
  const hash = createHash('sha256');
  for (const file of files.sort()) {
    let bytes: string | Buffer = read(file);
    if (file === 'cli/package.json') { const pkg = JSON.parse(bytes.toString()) as {version?: string}; delete pkg.version; bytes = JSON.stringify(pkg); }
    if (file === 'cli/src/version.ts') bytes = bytes.toString().replace(/export const VERSION = ['"][^'"]+['"]/, 'export const VERSION = "component"');
    if (file === 'local-access/tray/main.go') bytes = bytes.toString().replace(/const trayVersion = "[^"]+"/, 'const trayVersion = "component"');
    hash.update(file).update(bytes);
  }
  type Pkg = { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string>; [key: string]: unknown };
  const lock = JSON.parse(read('package-lock.json').toString()) as { packages: Record<string, Pkg> };
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    const entry = lock.packages[key];
    if (!entry) throw new Error(`Missing client dependency: ${key}`);
    const normalized = { ...entry };
    if (key === 'cli') delete normalized.version;
    hash.update(key).update(JSON.stringify(normalized));
    for (const name of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }).sort()) {
      if (name.startsWith('@pop-agent/')) continue;
      let parent = key;
      while (parent && !lock.packages[`${parent}/node_modules/${name}`]) {
        const cut = parent.lastIndexOf('/node_modules/');
        parent = cut >= 0 ? parent.slice(0, cut) : '';
      }
      const found = parent ? `${parent}/node_modules/${name}` : `node_modules/${name}`;
      if (lock.packages[found]) visit(found);
      else if (!entry.optionalDependencies?.[name]) throw new Error(`Missing client dependency: ${name}`);
    }
  };
  visit('cli');
  // Bundler inputs matter even when server-only dependencies change.
  visit('node_modules/esbuild');
  return hash.digest('hex');
}

export function validateClientLock(value: unknown): Lock {
  const lock = value as Lock;
  if (!lock || lock.schema !== 1 || !lock.source || !/^[\w.-]+\/[\w.-]+$/.test(lock.source.repository)
    || !semver.test(lock.source.version) || !semver.test(lock.cliVersion)
    || !/^[a-f0-9]{40}$/.test(lock.source.commit) || !/^[a-f0-9]{40}$/.test(lock.source.tree)
    || !/^[a-f0-9]{64}$/.test(lock.inputs) || !Number.isFinite(Date.parse(lock.source.verifiedAt))) throw new Error('Invalid pinned client release');
  const check = (entry: Entry) => {
    if (!entry || !safeFile.test(entry.file) || !Number.isSafeInteger(entry.size) || entry.size <= 0
      || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid pinned client artifact');
  };
  check(lock.source.archive);
  const required = ['package.json', `cli-${lock.cliVersion}.tgz`, 'launcher/manifest.json', 'local-access/manifest.json', 'runtime/node/manifest.json'];
  if (!lock.files || Object.keys(lock.files).length !== required.length) throw new Error('Incomplete client snapshot');
  for (const name of required) { check(lock.files[name]!); if (lock.files[name]!.file !== name.split('/').at(-1)) throw new Error('Invalid client snapshot path'); }
  for (const [name, source] of Object.entries(lock.sources ?? {})) {
    if (!/^(launcher|local-access)\/[\w.-]+$/.test(name) || !source
      || !/^[\w.-]+\/[\w.-]+$/.test(source.repository) || !semver.test(source.version)) throw new Error('Invalid inherited client source');
  }
  return lock;
}

function member(archive: string, name: string): Buffer {
  return execFileSync('tar', ['-xOf', archive, `cli/pack/${name}`], { maxBuffer: 64 * 1024 * 1024 });
}

export async function pinClients(root: string, directory: string): Promise<void> {
  const proof = JSON.parse(readFileSync(join(directory, 'verified.json'), 'utf8')) as { commit: string; verifiedAt: string };
  const version = git(root, ['show', `${proof.commit}:VERSION`]);
  const manifest = JSON.parse(readFileSync(join(directory, `pop-agent-${version}-linux-amd64.json`), 'utf8')) as Entry & { commit: string; tree: string };
  const archive = join(directory, manifest.file);
  if (!safeFile.test(manifest.file) || manifest.commit !== proof.commit || manifest.tree !== git(root, ['rev-parse', `${proof.commit}^{tree}`])
    || await fileHash(archive) !== manifest.sha256) throw new Error('Unverified client baseline');
  const repository = 'viniciusbuscacio/pop-agent';
  const published = JSON.parse(execFileSync(process.env['POP_AGENT_GH'] ?? 'gh', ['release', 'view', `v${version}`, '--repo', repository, '--json', 'isDraft'], { encoding: 'utf8' })) as { isDraft: boolean };
  if (published.isDraft !== false) throw new Error('Client baseline must already be published');
  const pkg = member(archive, 'package.json');
  const cliVersion = (JSON.parse(pkg.toString()) as {version: string}).version;
  const files: Record<string, Entry> = {};
  for (const name of ['package.json', `cli-${cliVersion}.tgz`, 'launcher/manifest.json', 'local-access/manifest.json', 'runtime/node/manifest.json']) {
    const bytes = member(archive, name);
    files[name] = { file: name.split('/').at(-1)!, size: bytes.length, sha256: digest(bytes) };
  }
  const catalog = JSON.parse(member(archive, 'client-downloads.json').toString()) as {schema?: number; repository?: string; version?: string; artifacts?: Record<string, {repository: string; version: string}>};
  const sources: Record<string, {repository: string; version: string}> = {};
  for (const category of ['launcher', 'local-access']) {
    const metadata = JSON.parse(member(archive, `${category}/manifest.json`).toString()) as {artifacts: Record<string, Entry>};
    for (const entry of Object.values(metadata.artifacts)) {
      const key = `${category}/${entry.file}`;
      const source = catalog.schema === 2 ? catalog.artifacts?.[key] : {repository: catalog.repository!, version: catalog.version!};
      if (!source) throw new Error(`Missing original client source: ${key}`);
      sources[key] = source;
    }
  }
  const lock = validateClientLock({ schema: 1, sources, source: { repository, version, commit: proof.commit, tree: manifest.tree,
    verifiedAt: proof.verifiedAt, archive: {file: manifest.file, size: manifest.size, sha256: manifest.sha256} },
    inputs: clientInputs(root, proof.commit), cliVersion, files });
  mkdirSync(join(root, 'release'), { recursive: true });
  writeFileSync(join(root, 'release/clients.json'), JSON.stringify(lock, null, 2) + '\n');
  const cache = join(process.env['POP_AGENT_RELEASE_HOME'] ?? join(homedir(), '.local/share/pop-agent/release-builder'), 'cache/client-releases');
  mkdirSync(cache, {recursive: true});
  copyFileSync(archive, join(cache, lock.source.archive.sha256 + '.tar.gz'));
  console.log(`Pinned published clients v${version} and cached their verified source archive.`);
}

export async function stageClients(root: string, cache: string): Promise<void> {
  const lock = validateClientLock(JSON.parse(readFileSync(join(root, 'release/clients.json'), 'utf8')));
  if (clientInputs(root) !== lock.inputs) throw new Error('Client or protocol inputs changed. Publish compatible clients and pin them before a server-only release.');
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, lock.source.archive.sha256 + '.tar.gz');
  if (!existsSync(archive) || await fileHash(archive) !== lock.source.archive.sha256) {
    const tmp = archive + '.tmp';
    try {
      execFileSync('curl', ['--fail', '--location', '--proto', '=https', '--proto-redir', '=https', '--max-time', '600', '--output', tmp,
        `https://github.com/${lock.source.repository}/releases/download/v${lock.source.version}/${lock.source.archive.file}`], { stdio: 'inherit' });
      if (await fileHash(tmp) !== lock.source.archive.sha256) throw new Error('Client baseline checksum mismatch');
      renameSync(tmp, archive);
    } finally { rmSync(tmp, { force: true }); }
  }
  const pack = join(root, 'cli/pack');
  // Only known members are read; tar never writes untrusted paths or symlinks.
  for (const [name, entry] of Object.entries(lock.files)) {
    const bytes = member(archive, name);
    if (bytes.length !== entry.size || digest(bytes) !== entry.sha256) throw new Error(`Client snapshot mismatch: ${name}`);
    mkdirSync(dirname(join(pack, name)), { recursive: true });
    writeFileSync(join(pack, name), bytes);
  }
  const artifacts: Record<string, { repository: string; version: string }> = {};
  for (const category of ['launcher', 'local-access']) {
    const manifest = JSON.parse(readFileSync(join(pack, category, 'manifest.json'), 'utf8')) as {artifacts: Record<string, Entry>};
    for (const entry of Object.values(manifest.artifacts)) {
      const key = `${category}/${entry.file}`;
      const source = lock.sources ? lock.sources[key] : {repository: lock.source.repository, version: lock.source.version};
      if (!source) throw new Error(`Missing pinned client source: ${key}`);
      artifacts[key] = source;
    }
  }
  writeFileSync(join(pack, 'client-downloads.json'), JSON.stringify({ schema: 2, artifacts }) + '\n');
  writeFileSync(join(pack, 'client-release.json'), JSON.stringify(lock, null, 2) + '\n');
  console.log(`Reusing verified clients from v${lock.source.version}; no native build required.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..');
  if (process.argv[2] === 'pin' && process.argv[3]) await pinClients(root, resolve(process.argv[3]));
  else if (process.argv[2] === 'stage' && process.argv[3]) await stageClients(root, resolve(process.argv[3]));
  else throw new Error('Usage: client-release.ts pin VERIFIED_RELEASE_DIRECTORY | stage CACHE_DIRECTORY');
}
