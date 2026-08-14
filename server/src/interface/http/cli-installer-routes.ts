import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    if (release === undefined) return c.notFound();
    return c.body(unixInstaller(requestOrigin(c), release), 200, {
      'content-type': 'text/x-shellscript; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="install.sh"',
    });
  });

  routes.get('/install.ps1', (c) => {
    const release = readLauncherRelease(deps.cliPack);
    if (release === undefined) return c.notFound();
    return c.body(windowsInstaller(requestOrigin(c), release), 200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="install.ps1"',
    });
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
Move-Item -Force $temporary $destination
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

function readLauncherRelease(cliPack: string): LauncherRelease | undefined {
  try {
    const release = JSON.parse(
      readFileSync(join(cliPack, 'launcher', 'manifest.json'), 'utf8'),
    ) as LauncherRelease;
    return typeof release.version === 'string' && release.artifacts !== undefined
      ? release
      : undefined;
  } catch {
    return undefined;
  }
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
