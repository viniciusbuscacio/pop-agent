import { Hono, type Context } from 'hono';

const MINIMUM_NODE_VERSION = '22.19.0';

export interface CliInstallerDeps {
  versions: { popAgentVersion: string };
}

/**
 * Serves the Windows bootstrap script from the same origin as the CLI package.
 * The origin is derived from the request so every self-hosted Pop instance
 * produces an installer for itself without a configured public URL.
 */
export function createCliInstallerRoutes(deps: CliInstallerDeps): Hono {
  const routes = new Hono();

  routes.get('/install.ps1', (c) => {
    return c.body(windowsInstaller(requestOrigin(c), deps.versions.popAgentVersion), 200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'content-disposition': 'inline; filename="install.ps1"',
    });
  });

  return routes;
}

export function windowsInstaller(origin: string, cliVersion: string): string {
  const quotedOrigin = powershellLiteral(origin);
  const quotedVersion = powershellLiteral(cliVersion);

  return `# Pop Agent CLI installer for Windows
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$serverOrigin = '${quotedOrigin}'
$cliVersion = '${quotedVersion}'
$minimumNodeVersion = [Version]'${MINIMUM_NODE_VERSION}'

function Update-ProcessPath {
  $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = @($machinePath, $userPath) -join ';'
}

function Find-Node {
  $command = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($null -ne $command) { return $command.Source }

  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\\nodejs\\node.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) { return $candidate }
  }
  return $null
}

function Read-NodeVersion([string]$nodePath) {
  if ([string]::IsNullOrWhiteSpace($nodePath)) { return $null }
  try {
    $text = (& $nodePath --version).Trim().TrimStart('v')
    return [Version]$text
  } catch {
    return $null
  }
}

if ($env:OS -ne 'Windows_NT') {
  throw 'This installer supports Windows only.'
}
if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'Pop Agent requires 64-bit Windows.'
}

Write-Host 'Installing Pop Agent CLI...'
$nodePath = Find-Node
$nodeVersion = Read-NodeVersion $nodePath

if ($null -eq $nodeVersion -or $nodeVersion -lt $minimumNodeVersion) {
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($null -eq $winget) {
    throw 'Node.js 22.19 or newer is required and winget is unavailable. Install Node.js LTS from https://nodejs.org/ and run this command again.'
  }

  Write-Host 'Installing a compatible Node.js LTS runtime...'
  & $winget.Source install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements --silent
  if ($LASTEXITCODE -ne 0) {
    throw "winget could not install Node.js (exit code $LASTEXITCODE)."
  }

  Update-ProcessPath
  $nodePath = Find-Node
  $nodeVersion = Read-NodeVersion $nodePath
}

if ($null -eq $nodeVersion -or $nodeVersion -lt $minimumNodeVersion) {
  throw "Node.js $minimumNodeVersion or newer was not found after installation. Close PowerShell, reopen it, and run this installer again."
}

$npmPath = Join-Path (Split-Path -Parent $nodePath) 'npm.cmd'
if (-not (Test-Path -LiteralPath $npmPath)) {
  $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($null -eq $npmCommand) { throw 'npm.cmd was not found beside Node.js or on PATH.' }
  $npmPath = $npmCommand.Source
}

$packageUrl = "$serverOrigin/cli-$cliVersion.tgz"
Write-Host "Node.js $nodeVersion detected."
Write-Host "Installing Pop Agent CLI $cliVersion from $serverOrigin..."
& $npmPath install --global $packageUrl
if ($LASTEXITCODE -ne 0) {
  throw "npm could not install Pop Agent CLI (exit code $LASTEXITCODE)."
}

$npmPrefix = (& $npmPath prefix --global).Trim()
if (-not [string]::IsNullOrWhiteSpace($npmPrefix)) {
  $env:Path = "$npmPrefix;$env:Path"
}
$popPath = Join-Path $npmPrefix 'pop.cmd'
if (-not (Test-Path -LiteralPath $popPath)) {
  $popCommand = Get-Command pop.cmd -ErrorAction SilentlyContinue
  if ($null -eq $popCommand) { throw 'Pop Agent CLI was installed, but pop.cmd could not be found.' }
  $popPath = $popCommand.Source
}

$installedVersion = (& $popPath --version).Trim()
Write-Host ''
Write-Host "$installedVersion installed successfully." -ForegroundColor Green
Write-Host "Next: pop login $serverOrigin"
`;
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

function powershellLiteral(value: string): string {
  return value.replaceAll("'", "''");
}
