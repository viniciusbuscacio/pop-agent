import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Build the real component wizard, with matching native tray and launcher payloads. */
export function buildMacosSetup(root: string, temporary: string, binary: string, version: string, arch: string): string {
  if (process.platform !== 'darwin' || !['arm64', 'amd64'].includes(arch)) throw new Error('Native macOS build required');
  const source = join(root, 'local-access/setup');
  const payload = join(source, 'payload');
  mkdirSync(payload, { recursive: true });
  for (const name of ["tray.exe", "launcher.exe"]) rmSync(join(payload, name), { force: true });
  const launcher = join(temporary, 'pop');
  const env = { ...process.env, GOOS: 'darwin', GOARCH: arch, CGO_ENABLED: '1' };
  execFileSync('go', ['build', '-trimpath', '-o', launcher, '.'], { cwd: join(root, 'launcher'), env, stdio: 'inherit' });
  execFileSync('codesign', ['--force', '--sign', '-', launcher], { stdio: 'inherit' });
  const entry = (path: string, name: string) => {
    const bytes = readFileSync(path);
    if (bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== (arch === 'arm64' ? 0x0100000c : 0x01000007)) throw new Error('Invalid native payload');
    copyFileSync(path, join(payload, name));
    return { file: name, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const manifest = { platform: 'darwin', version, tray: entry(binary, 'tray'), launcher: entry(launcher, 'launcher') };
  writeFileSync(join(payload, 'manifest.json'), JSON.stringify(manifest));
  copyFileSync(join(root, 'local-access/tray/app.icns'), join(payload, 'app.icns'));
  const app = join(temporary, 'Pop Agent Setup.app');
  const contents = join(app, 'Contents');
  mkdirSync(join(contents, 'MacOS'), { recursive: true });
  mkdirSync(join(contents, 'Resources'), { recursive: true });
  execFileSync('go', ['build', '-trimpath', '-tags=desktop,production', `-ldflags=-s -w -X main.version=${version}`, '-o', join(contents, 'MacOS', 'Pop Agent Setup'), '.'], { cwd: source, env, stdio: 'inherit' });
  copyFileSync(join(payload, 'app.icns'), join(contents, 'Resources', 'app.icns'));
  writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.popagent.setup</string>
<key>CFBundleName</key><string>Pop Agent Setup</string>
<key>CFBundleExecutable</key><string>Pop Agent Setup</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIconFile</key><string>app.icns</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleVersion</key><string>${version}</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>`);
  execFileSync('codesign', ['--force', '--sign', '-', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  return app;
}
