import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkNativeRuntime, fileHash, git, glibcVersion, RUNTIME_PATHS, validateTree, type RuntimeManifest } from './server-runtime.ts';

const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv[2] ?? '../pop-server-releases');
if (output === root || output.startsWith(`${root}/`)) throw new Error('Pack output must be outside the checkout');
if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch)) throw new Error('Build on the native Linux target');
if (git(root, ['status', '--porcelain']) !== '') throw new Error('Pack requires a clean committed checkout');
const commit = git(root, ['rev-parse', 'HEAD']);
const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
const receipt = JSON.parse(readFileSync(resolve(root, git(root, ['rev-parse', '--git-path', 'pop-agent-gate-receipt.json'])), 'utf8')) as { tree: string; node: string; completedAt: string };
if (receipt.tree !== tree || receipt.node !== process.version || !Number.isFinite(Date.parse(receipt.completedAt)) || Date.now() - Date.parse(receipt.completedAt) > 86_400_000) {
  throw new Error('Pack requires a fresh successful full gate for this exact tree and Node runtime');
}
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
const architecture = process.arch === 'x64' ? 'amd64' : 'arm64';
const file = `pop-agent-${version}-linux-${architecture}.tar.gz`;
mkdirSync(output, { recursive: true });
const stage = mkdtempSync(join(output, '.pack-'));
try {
  const runtime = join(stage, 'runtime');
  mkdirSync(runtime);
  const source = join(stage, 'source.tar');
  execFileSync('git', ['archive', '--output', source, 'HEAD'], { cwd: root });
  execFileSync('tar', ['-xf', source, '-C', runtime]);
  for (const path of RUNTIME_PATHS) {
    if (existsSync(join(root, path))) cpSync(join(root, path), join(runtime, path), { recursive: true, verbatimSymlinks: true });
  }
  // Preserve the already applied pi patches/native binaries; never rerun install scripts here.
  execFileSync('npm', ['prune', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: runtime, stdio: 'inherit' });
  for (const workspace of ['', 'server/', 'shared/', 'web/', 'cli/']) {
    const binaries = join(runtime, workspace, 'node_modules/onnxruntime-node/bin');
    if (!existsSync(binaries)) continue;
    for (const api of readdirSync(binaries)) {
      // Pop embeddings use CPU. These optional GPU providers are not runtime requirements.
      for (const provider of ['libonnxruntime_providers_cuda.so', 'libonnxruntime_providers_tensorrt.so']) {
        rmSync(join(binaries, api, process.platform, process.arch, provider), { force: true });
      }
      for (const platform of readdirSync(join(binaries, api))) {
        const directory = join(binaries, api, platform);
        if (platform !== process.platform) rmSync(directory, { recursive: true, force: true });
        else for (const arch of readdirSync(directory)) {
          if (arch !== process.arch) rmSync(join(directory, arch), { recursive: true, force: true });
        }
      }
    }
  }
  const cliVersion = (JSON.parse(readFileSync(join(runtime, 'cli/pack/package.json'), 'utf8')) as { version: string }).version;
  const reuseClients = existsSync(join(runtime, 'cli/pack/client-release.json'));
  for (const name of readdirSync(join(runtime, 'cli/pack'))) {
    if (/^cli-.*\.tgz$/.test(name) && name !== `cli-${cliVersion}.tgz`) rmSync(join(runtime, 'cli/pack', name));
  }
  const paths = RUNTIME_PATHS.filter((path) => existsSync(join(runtime, path)));
  for (const path of paths) validateTree(join(runtime, path), runtime);
  const audioProof = JSON.parse(readFileSync(join(runtime, 'server/dist/audio/smoke.json'), 'utf8')) as { passed: boolean; sha256: string; architecture: string };
  if (audioProof.passed !== true || audioProof.architecture !== process.arch || audioProof.sha256 !== await fileHash(join(runtime, 'server/dist/audio/ffmpeg'))) throw new Error('Run test:audio for this exact native audio binary before packing');
  await checkNativeRuntime(runtime, reuseClients ? 'lazy' : 'complete');
  const repository = process.env['GITHUB_REPOSITORY'] ?? 'viniciusbuscacio/pop-agent';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error('Invalid release repository');
  if (!reuseClients) writeFileSync(join(runtime, 'cli/pack/client-downloads.json'), JSON.stringify({ repository, version }));
  for (const directory of ['launcher', 'local-access', 'runtime/node']) {
    const base = join(runtime, 'cli/pack', directory);
    for (const name of readdirSync(base)) {
      if (name === 'manifest.json') continue;
      if (directory !== 'runtime/node' && process.arch === 'x64') {
        const destination = join(output, name);
        if (existsSync(destination) && await fileHash(destination) !== await fileHash(join(base, name))) throw new Error(`Conflicting client asset: ${name}`);
        if (!existsSync(destination)) cpSync(join(base, name), destination);
      }
      rmSync(join(base, name), { recursive: true, force: true });
    }
  }
  await checkNativeRuntime(runtime);
  execFileSync(process.execPath, ['tools/smoke.ts', '--built'], { cwd: runtime, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
  execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--hard-dereference', '-czf', join(stage, file), '-C', runtime, ...paths]);
  const manifest: RuntimeManifest = { schema: 1, version, commit, tree, platform: 'linux', architecture, node: process.version, glibc: glibcVersion(), gateCompletedAt: receipt.completedAt, file, size: statSync(join(stage, file)).size, sha256: await fileHash(join(stage, file)) };
  const name = file.replace('.tar.gz', '.json');
  writeFileSync(join(stage, name), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const artifact of [file, name]) {
    const destination = join(output, artifact);
    if (existsSync(destination)) {
      if (!lstatSync(destination).isFile() || await fileHash(destination) !== await fileHash(join(stage, artifact))) throw new Error(`Refusing to overwrite immutable artifact: ${artifact}`);
    } else renameSync(join(stage, artifact), destination);
  }
  console.log(`Packed ${file}: ${manifest.size} bytes; SHA-256 ${manifest.sha256}`);
} finally {
  rmSync(stage, { recursive: true, force: true });
}
