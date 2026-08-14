param([string]$VersionFile = $env:POP_AGENT_VERSION_FILE)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root
$version = (Get-Content -LiteralPath (Join-Path $root 'VERSION') -Raw).Trim()
if ($VersionFile) {
  $global = (Get-Content -LiteralPath $VersionFile -Raw).Trim()
  if ($global -ne $version) { throw "Desktop version $version does not match global Pop Agent version $global." }
}
$go = (Get-Command go.exe -ErrorAction SilentlyContinue).Source
if (-not $go) { $candidate = Join-Path $env:ProgramFiles 'Go\bin\go.exe'; if (Test-Path $candidate) { $go=$candidate } }
if (-not $go) { throw 'Go 1.23 or newer is required.' }
$bin = Join-Path $root 'build\bin'
$payload = Join-Path $root 'cmd\pop-desktop-setup\payload'
New-Item -ItemType Directory -Force -Path $bin,$payload | Out-Null
& $go build -trimpath -ldflags '-s -w -H windowsgui' -o (Join-Path $bin 'Pop Desktop Tray.exe') .
if ($LASTEXITCODE -ne 0) { throw 'Manager build failed.' }
& $go build -trimpath -ldflags '-s -w -H windowsgui' -o (Join-Path $bin 'Pop Desktop.exe') .\cmd\pop-desktop
if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
Set-Content -NoNewline -Encoding ascii -Path (Join-Path $bin 'Pop Desktop.exe.version') -Value $version
Copy-Item internal\tray\tray_windows.ico (Join-Path $bin 'Pop Desktop.ico') -Force
Copy-Item (Join-Path $bin 'Pop Desktop Tray.exe'),(Join-Path $bin 'Pop Desktop.exe'),(Join-Path $bin 'Pop Desktop.exe.version'),(Join-Path $bin 'Pop Desktop.ico') $payload -Force
& $go build -trimpath -ldflags '-s -w -H windowsgui' -o (Join-Path $bin 'Pop Desktop Setup.exe') .\cmd\pop-desktop-setup
if ($LASTEXITCODE -ne 0) { throw 'Setup build failed.' }
Remove-Item -Force (Join-Path $payload 'Pop Desktop Tray.exe'),(Join-Path $payload 'Pop Desktop.exe'),(Join-Path $payload 'Pop Desktop.exe.version'),(Join-Path $payload 'Pop Desktop.ico')
Write-Host "Built Pop Desktop Windows setup ($version): $(Join-Path $bin 'Pop Desktop Setup.exe')"
