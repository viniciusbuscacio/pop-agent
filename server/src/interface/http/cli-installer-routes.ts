import { createReadStream, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';

interface LauncherArtifact {
  file: string;
  size: number;
  sha256: string;
}

interface LauncherRelease {
  version: string;
  artifacts: Record<string, LauncherArtifact>;
}

type LocalAccessRelease = LauncherRelease;

export interface CliInstallerDeps {
  cliPack: string;
  versions: { popAgentVersion: string };
}

/**
 * Same-origin bootstrap scripts install the native `pop` launcher before a
 * session or Node CLI exists. They embed only the request origin and checksums
 * from the built launcher release; no password, token or user data.
 */
export function createCliInstallerRoutes(deps: CliInstallerDeps): Hono {
  const routes = new Hono();

  routes.get('/install.sh', (c) => {
    const release = readLauncherRelease(deps.cliPack);
    if (release === undefined || !hasArtifacts(release, [
      'darwin-arm64', 'darwin-amd64', 'linux-arm64', 'linux-amd64',
    ])) return c.notFound();
    return c.body(unixInstaller(requestOrigin(c), release), 200, {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="install.sh"',
    });
  });

  routes.get('/install.ps1', (c) => {
    const release = readLauncherRelease(deps.cliPack);
    if (release === undefined || !hasArtifacts(release, ['windows-amd64'])) return c.notFound();
    return c.body(windowsInstaller(requestOrigin(c), release), 200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="install.ps1"',
    });
  });

  routes.get('/install-local-access.sh', (c) => {
    const release = readLocalAccessRelease(deps.cliPack);
    if (readLauncherRelease(deps.cliPack) === undefined || release === undefined) return c.notFound();
    return c.body(unixLocalAccessInstaller(requestOrigin(c), release), 200, {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="install-local-access.sh"',
    });
  });

  routes.get('/install-local-access.ps1', (c) => {
    const release = readLocalAccessRelease(deps.cliPack);
    const launcher = readLauncherRelease(deps.cliPack);
    if (
      launcher === undefined || !hasArtifacts(launcher, ['windows-amd64']) ||
      release === undefined || !hasArtifacts(release, ['windows-amd64'])
    ) return c.notFound();
    return c.body(windowsLocalAccessInstaller(requestOrigin(c), release), 200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="install-local-access.ps1"',
    });
  });

  routes.get('/local-access/:file', (c) => {
    const release = readLocalAccessRelease(deps.cliPack);
    const artifact = release === undefined
      ? undefined
      : Object.values(release.artifacts).find((entry) => entry.file === c.req.param('file'));
    if (artifact === undefined) return c.notFound();
    const path = join(deps.cliPack, 'local-access', artifact.file);
    try {
      if (statSync(path).size !== artifact.size) return c.notFound();
      return c.body(Readable.toWeb(createReadStream(path)) as ReadableStream, 200, {
        'content-type': 'application/octet-stream',
        'content-length': String(artifact.size),
        'cache-control': 'public, max-age=31536000, immutable',
        'content-disposition': `attachment; filename="${artifact.file}"`,
      });
    } catch {
      return c.notFound();
    }
  });

  return routes;
}

export function unixInstaller(origin: string, release: LauncherRelease): string {
  const cases = ['darwin-arm64', 'darwin-amd64', 'linux-arm64', 'linux-amd64']
    .map((target) => {
      const artifact = requiredArtifact(release, target);
      return `  ${target}) file='${shellLiteral(artifact.file)}'; sha='${artifact.sha256}' ;;`;
    })
    .join('\n');
  return `#!/bin/sh
set -eu
origin='${shellLiteral(origin)}'
version='${shellLiteral(release.version)}'
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in
  arm64|aarch64) arch=arm64 ;;
  x86_64|amd64) arch=amd64 ;;
  *) echo "Pop launcher does not support architecture: $arch" >&2; exit 1 ;;
esac
case "$os-$arch" in
${cases}
  *) echo "Pop launcher does not support platform: $os-$arch" >&2; exit 1 ;;
esac
install_dir="\${POP_LAUNCHER_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$install_dir"
tmp="$install_dir/.pop-$version.tmp"
trap 'rm -f "$tmp"' EXIT HUP INT TERM
curl -fsSL --retry 2 "$origin/cli/launcher/$file" -o "$tmp"
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$tmp" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
  actual=$(shasum -a 256 "$tmp" | awk '{print $1}')
else
  echo 'A SHA-256 tool (sha256sum or shasum) is required.' >&2
  exit 1
fi
if [ "$actual" != "$sha" ]; then
  echo "Pop launcher checksum mismatch: got $actual, expected $sha" >&2
  exit 1
fi
chmod 755 "$tmp"
mv -f "$tmp" "$install_dir/pop"
trap - EXIT HUP INT TERM
case ":$PATH:" in
  *":$install_dir:"*) ;;
  *)
    profile="$HOME/.profile"
    [ "\${SHELL##*/}" = zsh ] && profile="$HOME/.zprofile"
    marker='export PATH="$HOME/.local/bin:$PATH"'
    grep -F "$marker" "$profile" >/dev/null 2>&1 || printf '\n%s\n' "$marker" >> "$profile"
    export PATH="$install_dir:$PATH"
    ;;
esac
echo "Pop launcher $version installed at $install_dir/pop"
echo "Next: $install_dir/pop login $origin"
`;
}

export function windowsInstaller(origin: string, release: LauncherRelease): string {
  const artifact = requiredArtifact(release, 'windows-amd64');
  return `# Pop Agent launcher installer for 64-bit Windows
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (-not [Environment]::Is64BitOperatingSystem) { throw 'Pop Agent requires 64-bit Windows.' }
$origin = '${powershellLiteral(origin)}'
$version = '${powershellLiteral(release.version)}'
$file = '${powershellLiteral(artifact.file)}'
$expected = '${artifact.sha256}'
$installDir = Join-Path $env:LOCALAPPDATA 'PopAgent\\bin'
$destination = Join-Path $installDir 'pop.exe'
$temporary = Join-Path $installDir ".pop-$version.tmp.exe"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Invoke-WebRequest -UseBasicParsing "$origin/cli/launcher/$file" -OutFile $temporary
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $temporary).Hash.ToLowerInvariant()
if ($actual -ne $expected) {
  Remove-Item -Force $temporary
  throw "Pop launcher checksum mismatch: got $actual, expected $expected"
}
if (Test-Path -LiteralPath $destination) {
  $backup = "$destination.previous"
  Remove-Item -Force -ErrorAction SilentlyContinue $backup
  try {
    [IO.File]::Replace($temporary, $destination, $backup)
  } catch {
    $activationError = $_
    Remove-Item -Force -ErrorAction SilentlyContinue $temporary
    if (Test-Path -LiteralPath $backup) {
      if (Test-Path -LiteralPath $destination) {
        [IO.File]::Replace($backup, $destination, $null)
      } else {
        Move-Item -LiteralPath $backup -Destination $destination
      }
    }
    throw $activationError
  }
  Remove-Item -Force -ErrorAction SilentlyContinue $backup
} else {
  Move-Item -LiteralPath $temporary -Destination $destination
}
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($userPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
if ($parts -notcontains $installDir) {
  [Environment]::SetEnvironmentVariable('Path', ((@($installDir) + $parts) -join ';'), 'User')
}
$env:Path = "$installDir;$env:Path"
Write-Host "Pop launcher $version installed at $destination" -ForegroundColor Green
Write-Host "Next: pop login $origin"
`;
}

export function unixLocalAccessInstaller(origin: string, release: LocalAccessRelease): string {
  const cases = ['darwin-arm64', 'darwin-amd64']
    .flatMap((target) => {
      const artifact = release.artifacts[target];
      return artifact === undefined
        ? []
        : [`  ${target}) file='${shellLiteral(artifact.file)}'; sha='${artifact.sha256}' ;;`];
    })
    .join('\n');
  return `#!/usr/bin/env bash
set -euo pipefail
origin='${shellLiteral(origin)}'
pop_bin="$HOME/.local/bin/pop"
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT HUP INT TERM
curl -fsSL --retry 2 "$origin/install.sh" -o "$tmp"
sh "$tmp"
if ! command -v node >/dev/null 2>&1 && ! "$pop_bin" runtime doctor >/dev/null 2>&1; then
  "$pop_bin" runtime install --server "$origin"
fi
"$pop_bin" login "$origin" --no-chat

os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=amd64 ;; esac
case "$os-$arch" in
${cases}
  *) echo "Pop Local Access tray is not released for $os-$arch yet." >&2; exit 1 ;;
esac
app="$HOME/Applications/Pop Local Access.app"
bin="$app/Contents/MacOS/Pop Local Access"
mkdir -p "$app/Contents/MacOS"
curl -fsSL --retry 2 "$origin/local-access/$file" -o "$tmp"
actual=$(shasum -a 256 "$tmp" | awk '{print $1}')
[ "$actual" = "$sha" ] || { echo "Pop Local Access checksum mismatch." >&2; exit 1; }
chmod 755 "$tmp"
mv -f "$tmp" "$bin"
cat > "$app/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.popagent.local-access</string>
<key>CFBundleName</key><string>Pop Local Access</string>
<key>CFBundleExecutable</key><string>Pop Local Access</string>
<key>LSUIElement</key><true/>
</dict></plist>
EOF
label='com.popagent.local-access'
plist="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/LaunchAgents"
escaped_bin=$(printf '%s' "$bin" | sed 's/&/\\&amp;/g; s/</\\&lt;/g; s/>/\\&gt;/g')
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>Label</key><string>$label</string><key>ProgramArguments</key><array><string>$escaped_bin</string></array><key>RunAtLoad</key><true/></dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$label" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$plist"
launchctl kickstart -k "gui/$(id -u)/$label"
trap - EXIT HUP INT TERM
echo 'Pop Local Access is installed. Look for it in the macOS menu bar.'
`;
}

export function windowsLocalAccessInstaller(origin: string, release: LocalAccessRelease): string {
  const artifact = requiredArtifact(release, 'windows-amd64');
  return `# Pop Local Access installer for 64-bit Windows
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$origin = '${powershellLiteral(origin)}'
$bootstrap = Join-Path ([IO.Path]::GetTempPath()) ('pop-install-' + [guid]::NewGuid().ToString('N') + '.ps1')
try {
  Invoke-WebRequest -UseBasicParsing "$origin/install.ps1" -OutFile $bootstrap
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $bootstrap
  if ($LASTEXITCODE -ne 0) { throw "Pop launcher installation failed with exit code $LASTEXITCODE" }
} finally { Remove-Item -Force -ErrorAction SilentlyContinue $bootstrap }
$pop = Join-Path $env:LOCALAPPDATA 'PopAgent\\bin\\pop.exe'
& $pop runtime install --server $origin
if ($LASTEXITCODE -ne 0) { throw 'Pop managed Node runtime installation failed.' }
& $pop login $origin --no-chat
if ($LASTEXITCODE -ne 0) { throw 'Pop Agent sign-in did not complete.' }
$configRoot = if ([string]::IsNullOrWhiteSpace($env:XDG_CONFIG_HOME)) { Join-Path $HOME '.config\\pop-agent' } else { Join-Path $env:XDG_CONFIG_HOME 'pop-agent' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
foreach ($path in @($configRoot, (Join-Path $configRoot 'profiles.json'))) {
  if (Test-Path -LiteralPath $path) {
    & icacls.exe $path /inheritance:r /grant:r "\${identity}:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not protect $path" }
  }
}
$installDir = Join-Path $env:LOCALAPPDATA 'PopAgent\\LocalAccess'
$tray = Join-Path $installDir 'pop-local-access.exe'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('pop-local-access-' + [guid]::NewGuid().ToString('N') + '.exe')
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Invoke-WebRequest -UseBasicParsing "$origin/local-access/${powershellLiteral(artifact.file)}" -OutFile $tmp
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash.ToLowerInvariant()
if ($actual -ne '${artifact.sha256}') { Remove-Item -Force $tmp; throw 'Pop Local Access checksum mismatch.' }
$backup = "$tray.previous"
$runningTray = @(Get-CimInstance Win32_Process -Filter "Name = 'pop-local-access.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ExecutablePath -eq $tray })
# Stop the entire tree before replacing the executable; killing only the tray
# can leave its Node transport alive with local access.
$taskkill = Join-Path $env:SystemRoot 'System32\\taskkill.exe'
$runningTray | ForEach-Object {
  $termination = Start-Process -FilePath $taskkill -ArgumentList @('/PID', [string]$_.ProcessId, '/T', '/F') -WindowStyle Hidden -Wait -PassThru
  if ($termination.ExitCode -ne 0) { throw 'Could not stop the existing Pop Local Access process tree.' }
}
$runningTray | ForEach-Object { Wait-Process -Id $_.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }
Remove-Item -Force -ErrorAction SilentlyContinue $backup
if (Test-Path -LiteralPath $tray) { Move-Item -Force $tray $backup }
try {
  Move-Item -Force $tmp $tray
  Start-Process -FilePath $tray -WindowStyle Hidden
  Remove-Item -Force -ErrorAction SilentlyContinue $backup
} catch {
  Remove-Item -Force -ErrorAction SilentlyContinue $tray
  if (Test-Path -LiteralPath $backup) {
    Move-Item -Force $backup $tray
    Start-Process -FilePath $tray -WindowStyle Hidden
  }
  throw
}
# Use the same Pop icon in the Start menu; the tray executable has no shell icon resource.
$iconPath = Join-Path $installDir 'pop.ico'
$iconTmp = Join-Path ([IO.Path]::GetTempPath()) ('pop-icon-' + [guid]::NewGuid().ToString('N') + '.ico')
try {
  Invoke-WebRequest -UseBasicParsing "$origin/pop-local-access.ico" -OutFile $iconTmp
  if ((Get-FileHash -Algorithm SHA256 -LiteralPath $iconTmp).Hash.ToLowerInvariant() -ne '83eb214365a982aa6cf24875b3e65203050b103c6802f15e9687c70b9464f6b3') { throw 'Pop icon checksum mismatch.' }
  Move-Item -LiteralPath $iconTmp -Destination $iconPath -Force
} finally { Remove-Item -LiteralPath $iconTmp -Force -ErrorAction SilentlyContinue }
# Install or repair the per-user Start menu shortcut on every installation.
$programs = [Environment]::GetFolderPath('Programs')
New-Item -ItemType Directory -Force -Path $programs | Out-Null
$shortcutPath = Join-Path $programs 'Pop Local Access.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $tray
$shortcut.WorkingDirectory = $installDir
$shortcut.IconLocation = $iconPath + ',0'
$shortcut.Description = 'Connect this computer to Pop Agent for local file and command access.'
$shortcut.Save()
$run = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
New-Item -Path $run -Force | Out-Null
Set-ItemProperty -Path $run -Name 'Pop Local Access' -Value ('"' + $tray + '"')
Write-Host 'Pop Local Access is installed. Open Pop Local Access from the Start menu or find its icon in the Windows tray.' -ForegroundColor Green
`;
}

function readLauncherRelease(cliPack: string): LauncherRelease | undefined {
  return readRelease(join(cliPack, 'launcher', 'manifest.json'));
}

function readLocalAccessRelease(cliPack: string): LocalAccessRelease | undefined {
  return readRelease(join(cliPack, 'local-access', 'manifest.json'));
}

function readRelease(path: string): LauncherRelease | undefined {
  try {
    const release = JSON.parse(readFileSync(path, 'utf8')) as LauncherRelease;
    if (!/^\d+\.\d+\.\d+$/.test(release.version) || release.artifacts === undefined) return undefined;
    const entries = Object.entries(release.artifacts);
    if (entries.length === 0) return undefined;
    const files = new Set<string>();
    for (const [target, artifact] of entries) {
      if (
        !/^(?:darwin|linux|windows)-(?:arm64|amd64)$/.test(target) ||
        artifact.file.includes('/') || artifact.file.includes('\\') || files.has(artifact.file) ||
        !Number.isSafeInteger(artifact.size) || artifact.size <= 0 ||
        !/^[a-f0-9]{64}$/.test(artifact.sha256)
      ) {
        return undefined;
      }
      files.add(artifact.file);
    }
    return release;
  } catch {
    return undefined;
  }
}

function hasArtifacts(release: LauncherRelease, targets: string[]): boolean {
  return targets.every((target) => release.artifacts[target] !== undefined);
}

function requiredArtifact(release: LauncherRelease, target: string): LauncherArtifact {
  const artifact = release.artifacts[target];
  if (artifact === undefined) throw new Error(`launcher release has no ${target} artifact`);
  return artifact;
}

function requestOrigin(c: Context): string {
  const host = c.req.header('host') ?? new URL(c.req.url).host;
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim();
  const scheme = forwarded === 'http' || forwarded === 'https'
    ? forwarded
    : host.startsWith('localhost') || host.startsWith('127.0.0.1')
      ? 'http'
      : 'https';
  return new URL(`${scheme}://${host}`).origin;
}

function shellLiteral(value: string): string {
  return value.replaceAll("'", "'\\''");
}

function powershellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
