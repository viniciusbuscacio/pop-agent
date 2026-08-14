param([string]$VersionFile = $env:POP_AGENT_VERSION_FILE)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$go = (Get-Command go.exe -ErrorAction SilentlyContinue).Source
if (-not $go) {
  $candidate = Join-Path $env:ProgramFiles 'Go\bin\go.exe'
  if (Test-Path -LiteralPath $candidate) { $go = $candidate }
}
if (-not $go) { throw 'Go 1.23 or newer is required.' }

& $go vet ./...
if ($LASTEXITCODE -ne 0) { throw 'go vet failed' }
& $go test ./...
if ($LASTEXITCODE -ne 0) { throw 'go test failed' }
& (Join-Path $root 'build-windows.ps1') -VersionFile $VersionFile
Write-Host 'Windows gate passed'
