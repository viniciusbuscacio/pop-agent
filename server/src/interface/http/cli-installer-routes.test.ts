import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCliInstallerRoutes,
  unixInstaller,
  unixLocalAccessInstaller,
  windowsInstaller,
  windowsLocalAccessInstaller,
} from './cli-installer-routes.js';

const release = {
  version: '1.0.0',
  artifacts: {
    'darwin-arm64': { file: 'pop-launcher-1.0.0-darwin-arm64', size: 10, sha256: 'a'.repeat(64) },
    'darwin-amd64': { file: 'pop-launcher-1.0.0-darwin-amd64', size: 10, sha256: 'b'.repeat(64) },
    'linux-arm64': { file: 'pop-launcher-1.0.0-linux-arm64', size: 10, sha256: 'c'.repeat(64) },
    'linux-amd64': { file: 'pop-launcher-1.0.0-linux-amd64', size: 10, sha256: 'd'.repeat(64) },
    'windows-amd64': { file: 'pop-launcher-1.0.0-windows-amd64.exe', size: 10, sha256: 'e'.repeat(64) },
  },
};

describe('native Pop launcher installers', () => {
  let cliPack: string;

  beforeEach(() => {
    cliPack = mkdtempSync(join(tmpdir(), 'pop-launcher-pack-'));
    mkdirSync(join(cliPack, 'launcher'));
    writeFileSync(join(cliPack, 'launcher', 'manifest.json'), JSON.stringify(release));
    mkdirSync(join(cliPack, 'local-access'));
    const localRelease = {
      version: '0.2.30',
      artifacts: {
        'darwin-arm64-setup': { file: 'pop-local-access-0.2.30-darwin-arm64-setup.dmg', size: 10, sha256: '4'.repeat(64) },
        'windows-amd64-setup': { file: 'pop-local-access-0.2.30-windows-amd64-setup.exe', size: 10, sha256: '5'.repeat(64) },
        'darwin-arm64': { file: 'pop-local-access-0.2.30-darwin-arm64', size: 10, sha256: '1'.repeat(64) },
        'darwin-amd64': { file: 'pop-local-access-0.2.30-darwin-amd64', size: 10, sha256: '2'.repeat(64) },
        'windows-amd64': { file: 'pop-local-access-0.2.30-windows-amd64.exe', size: 10, sha256: '3'.repeat(64) },
      },
    };
    writeFileSync(join(cliPack, 'local-access', 'manifest.json'), JSON.stringify(localRelease));
    for (const artifact of Object.values(localRelease.artifacts)) {
      writeFileSync(join(cliPack, 'local-access', artifact.file), '0123456789');
    }
  });

  afterEach(() => rmSync(cliPack, { recursive: true, force: true }));

  it('offers the raw Mac executable for in-app updates instead of the setup DMG', async () => {
    const routes = createCliInstallerRoutes({ cliPack, versions: { popAgentVersion: '0.2.30' } });
    const response = await routes.request('http://localhost/desktop-update.json?platform=darwin&arch=arm64');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ version: '0.2.30', file: 'pop-local-access-0.2.30-darwin-arm64' });
    expect((await routes.request('http://localhost/desktop-update.json?platform=darwin&arch=invalid')).status).toBe(404);
  });

  it('publishes installer metadata and downloads without exposing any account data', async () => {
    const routes = createCliInstallerRoutes({ cliPack, versions: { popAgentVersion: '0.2.30' } });
    const response = await routes.request('http://localhost/local-access-update.json?platform=darwin&arch=arm64');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const metadata = await response.json();
    expect(metadata).toEqual({ version: '0.2.30', file: 'pop-local-access-0.2.30-darwin-arm64-setup.dmg', size: 10, sha256: '4'.repeat(64) });
    const download = await routes.request(`http://localhost/local-access/${metadata.file}`);
    expect(download.status).toBe(200);
    expect(await download.text()).toBe('0123456789');
    expect((await routes.request('http://localhost/local-access-update.json?platform=darwin&arch=amd64')).status).toBe(404);
    expect((await routes.request('http://localhost/local-access-update.json?platform=linux&arch=arm64')).status).toBe(404);
  });

  it('redirects the stable installer link to the current immutable setup', async () => {
    const routes = createCliInstallerRoutes({ cliPack, versions: { popAgentVersion: '0.2.30' } });
    const response = await routes.request('http://localhost/local-access-installer?platform=windows&arch=amd64');

    expect(response.status).toBe(302);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('location')).toBe('/local-access/pop-local-access-0.2.30-windows-amd64-setup.exe');
    expect((await routes.request('http://localhost/local-access-installer?platform=windows&arch=arm64')).status).toBe(404);
    expect((await routes.request('http://localhost/local-access-installer?platform=linux&arch=amd64')).status).toBe(404);
  });

  it('builds the Windows launcher URL from the server that received the request', async () => {
    const routes = createCliInstallerRoutes({ cliPack, versions: { popAgentVersion: '0.2.23' } });
    const response = await routes.request('https://personal-pop.example/install.ps1');
    const script = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(script).toContain("$origin = 'https://personal-pop.example'");
    expect(script).toContain('pop-launcher-1.0.0-windows-amd64.exe');
    expect(script).toContain('Get-FileHash -Algorithm SHA256');
    expect(script).toContain('Next: pop login $origin');
  });

  it('replaces an existing Windows launcher without relying on Move-Item overwrite', () => {
    const script = windowsInstaller('https://personal-pop.example', release);
    const verifiedAt = script.indexOf('if ($actual -ne $expected)');
    const replacementAt = script.indexOf('[IO.File]::Replace($temporary, $destination, $backup)');

    expect(script).toContain('if (Test-Path -LiteralPath $destination) {');
    expect(script).toContain('$backup = "$destination.previous"');
    expect(script).toContain('if (Test-Path -LiteralPath $backup) {');
    expect(script).toContain('[IO.File]::Replace($backup, $destination, $null)');
    expect(script).toContain('Move-Item -LiteralPath $backup -Destination $destination');
    expect(script).toContain('} else {\n  Move-Item -LiteralPath $temporary -Destination $destination\n}');
    expect(script).not.toContain('Move-Item -Force $temporary $destination');
    expect(replacementAt).toBeGreaterThan(verifiedAt);
  });

  it('serves a checksum-validating Unix installer', async () => {
    const routes = createCliInstallerRoutes({ cliPack, versions: { popAgentVersion: '0.2.23' } });
    const response = await routes.request('https://personal-pop.example/install.sh');
    const script = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/x-shellscript');
    expect(script).toContain("origin='https://personal-pop.example'");
    expect(script).toContain('darwin-arm64)');
    expect(script).toContain('sha256sum');
    expect(script).toContain('$HOME/.local/bin');
  });

  it('serves background PLA installers for PowerShell and bash', async () => {
    const routes = createCliInstallerRoutes({ cliPack, versions: { popAgentVersion: '0.2.23' } });
    const unix = await (await routes.request('https://personal-pop.example/install-local-access.sh')).text();
    const windows = await (await routes.request('https://personal-pop.example/install-local-access.ps1')).text();

    expect(unix).toContain("origin='https://personal-pop.example'");
    expect(unix).toContain('Pop Local Access.app');
    expect(unix).toContain('com.popagent.local-access');
    expect(unix).toContain('runtime install --server "$origin"');
    expect(unix).toContain('launchctl bootstrap');
    expect(windows).toContain("$origin = 'https://personal-pop.example'");
    expect(windows).toContain('pop-local-access-0.2.30-windows-amd64.exe');
    expect(windows).toContain("Name 'Pop Local Access'");
    expect(windows).toContain('icacls.exe');
    expect(windows).toContain('$backup = "$tray.previous"');
    expect(windows.indexOf('$termination = Start-Process')).toBeLessThan(windows.indexOf('Move-Item -Force $tmp $tray'));
    expect(windows).not.toContain('secret-session');
  });

  it('keeps the public HTTPS origin behind the local reverse proxy', async () => {
    const routes = createCliInstallerRoutes({ cliPack, versions: { popAgentVersion: '0.2.23' } });
    const response = await routes.request('http://127.0.0.1:3000/install.ps1', {
      headers: { host: 'personal-pop.example', 'x-forwarded-proto': 'https' },
    });

    expect(await response.text()).toContain("$origin = 'https://personal-pop.example'");
  });

  it('quotes values embedded in shell and PowerShell literals', () => {
    expect(windowsInstaller("https://pop.example/a'b", release)).toContain(
      "$origin = 'https://pop.example/a''b'",
    );
    expect(unixInstaller("https://pop.example/a'b", release)).toContain(
      "origin='https://pop.example/a'\\''b'",
    );
    expect(unixLocalAccessInstaller("https://pop.example/a'b", release)).toContain(
      "origin='https://pop.example/a'\\''b'",
    );
    expect(windowsLocalAccessInstaller("https://pop.example/a'b", release)).toContain(
      "$origin = 'https://pop.example/a''b'",
    );
  });

  it('404s until the launcher release has been packed', async () => {
    rmSync(join(cliPack, 'launcher'), { recursive: true });
    const routes = createCliInstallerRoutes({ cliPack, versions: { popAgentVersion: '0.2.23' } });
    expect((await routes.request('/install.sh')).status).toBe(404);
    expect((await routes.request('/install.ps1')).status).toBe(404);
  });

  it('refuses incomplete or unsafe release manifests instead of rendering a broken script', async () => {
    writeFileSync(join(cliPack, 'launcher', 'manifest.json'), JSON.stringify({
      version: '1.0.0',
      artifacts: {
        'windows-amd64': { file: '../pop.exe', size: 10, sha256: 'e'.repeat(64) },
      },
    }));
    const routes = createCliInstallerRoutes({ cliPack, versions: { popAgentVersion: '0.2.23' } });
    expect((await routes.request('/install.ps1')).status).toBe(404);
    expect((await routes.request('/install.sh')).status).toBe(404);
  });
});
