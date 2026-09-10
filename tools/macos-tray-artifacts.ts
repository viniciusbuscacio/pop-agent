import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const architectures = ['arm64', 'amd64'] as const;
interface Artifact { file: string; size: number; sha256: string }
interface Manifest { version: string; commit: string; artifacts: Record<string, Artifact> }
const hash = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

/** Require native macOS bytes from the exact release checkout before packaging. */
export function importMacosTray(directory: string, output: string | undefined, version: string, commit: string): void {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')) as Manifest;
  if (manifest.version !== version || manifest.commit !== commit) throw new Error('macOS tray artifacts do not match this release commit/version');
  for (const arch of architectures) {
    const target = `darwin-${arch}`;
    const file = `pop-local-access-${version}-${target}`;
    const entry = manifest.artifacts[target];
    if (!entry || entry.file !== file) throw new Error(`Missing macOS tray: ${target}`);
    const bytes = readFileSync(join(directory, file));
    const cpu = arch === 'arm64' ? 0x0100000c : 0x01000007;
    if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== cpu) throw new Error(`Invalid macOS executable: ${target}`);
    if (bytes.length !== entry.size || hash(bytes) !== entry.sha256) throw new Error(`macOS tray integrity failed: ${target}`);
  }
  if (output !== undefined) {
    mkdirSync(output, { recursive: true });
    const path = join(output, 'manifest.json');
    const packed = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    if (packed.version !== version) throw new Error('Packed tray version differs');
    for (const arch of architectures) {
      const target = `darwin-${arch}`;
      const entry = manifest.artifacts[target]!;
      copyFileSync(join(directory, entry.file), join(output, entry.file));
      packed.artifacts[target] = entry;
    }
    writeFileSync(path, JSON.stringify(packed, null, 2) + '\n');
  }
}

function build(root: string, directory: string, version: string, commit: string): void {
  if (process.platform !== 'darwin') throw new Error('Build macOS tray on a Mac with Xcode command-line tools');
  if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Build from a clean committed checkout');
  const cwd = join(root, 'local-access/tray');
  execFileSync('go', ['test', './...'], { cwd, stdio: 'inherit' });
  mkdirSync(directory, { recursive: true });
  const manifest: Manifest = { version, commit, artifacts: {} };
  for (const arch of architectures) {
    const file = `pop-local-access-${version}-darwin-${arch}`;
    const destination = join(directory, file);
    execFileSync('go', ['build', '-trimpath', '-ldflags=-s -w', '-o', destination, '.'], {
      cwd, stdio: 'inherit', env: { ...process.env, CGO_ENABLED: '1', GOOS: 'darwin', GOARCH: arch },
    });
    execFileSync('codesign', ['--force', '--sign', '-', destination], { stdio: 'inherit' });
    execFileSync('codesign', ['--verify', '--strict', destination], { stdio: 'inherit' });
    const bytes = readFileSync(destination);
    manifest.artifacts[`darwin-${arch}`] = { file, size: bytes.length, sha256: hash(bytes) };
  }
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  importMacosTray(directory, undefined, version, commit);
  console.log(`Verified macOS tray artifacts for ${version} at ${commit}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const root = resolve(import.meta.dirname, '..');
  const [mode, directory] = process.argv.slice(2);
  if (!directory || (mode !== 'build' && mode !== 'check')) throw new Error('Usage: node tools/macos-tray-artifacts.ts build|check DIRECTORY');
  const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  if (mode === 'build') build(root, resolve(directory), version, commit);
  else importMacosTray(resolve(directory), undefined, version, commit);
}
