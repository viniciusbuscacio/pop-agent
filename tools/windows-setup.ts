import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Artifact { file: string; size: number; sha256: string }

export function setupPayload(bytes: Buffer, artifact: Artifact, name: 'tray' | 'launcher'): { file: string; size: number; sha256: string } {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.length < 2 || bytes.toString('ascii', 0, 2) !== 'MZ' || bytes.length !== artifact.size || sha256 !== artifact.sha256) {
    throw new Error(`Invalid Windows ${name} payload`);
  }
  return { file: `${name}.exe`, size: bytes.length, sha256 };
}

/** A distinct Wails setup using go-installer, never a renamed copy of the tray. */
export function packWindowsSetup(root: string, version: string, pack: string, tray: Artifact, launcher: Artifact): Artifact {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid setup version');
  const source = join(root, 'local-access/setup');
  const payload = join(source, 'payload');
  mkdirSync(payload, { recursive: true });
  for (const name of ["tray", "launcher", "app.icns"]) rmSync(join(payload, name), { force: true });
  const trayBytes = readFileSync(join(pack, 'local-access', tray.file));
  const launcherBytes = readFileSync(join(pack, 'launcher', launcher.file));
  const manifest = { version, tray: setupPayload(trayBytes, tray, 'tray'), launcher: setupPayload(launcherBytes, launcher, 'launcher') };
  writeFileSync(join(payload, 'tray.exe'), trayBytes);
  writeFileSync(join(payload, 'launcher.exe'), launcherBytes);
  writeFileSync(join(payload, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const file = `pop-local-access-${version}-windows-amd64-setup.exe`;
  const destination = join(pack, 'local-access', file);
  execFileSync('go', ['build', '-trimpath', '-tags=desktop,production', `-ldflags=-s -w -H=windowsgui -X main.version=${version}`, '-o', destination, '.'], {
    cwd: source, env: { ...process.env, GOOS: 'windows', GOARCH: 'amd64', CGO_ENABLED: '0' }, stdio: 'inherit',
  });
  const bytes = readFileSync(destination);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 === tray.sha256 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Windows setup must be a distinct executable');
  return { file, size: bytes.length, sha256 };
}
