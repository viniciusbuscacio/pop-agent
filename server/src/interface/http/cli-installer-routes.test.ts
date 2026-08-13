import { describe, expect, it } from 'vitest';
import { createCliInstallerRoutes, windowsInstaller } from './cli-installer-routes.js';

describe('Windows CLI installer', () => {
  it('builds the package URL from the server that received the request', async () => {
    const routes = createCliInstallerRoutes({ versions: { popAgentVersion: '0.2.15' } });
    const response = await routes.request('https://personal-pop.example/install.ps1');
    const script = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(script).toContain("$serverOrigin = 'https://personal-pop.example'");
    expect(script).toContain("$cliVersion = '0.2.15'");
    expect(script).toContain('$packageUrl = "$serverOrigin/cli-$cliVersion.tgz"');
  });

  it('keeps the public HTTPS origin behind the local reverse proxy', async () => {
    const routes = createCliInstallerRoutes({ versions: { popAgentVersion: '0.2.15' } });
    const response = await routes.request('http://127.0.0.1:3000/install.ps1', {
      headers: { host: 'personal-pop.example', 'x-forwarded-proto': 'https' },
    });

    expect(await response.text()).toContain("$serverOrigin = 'https://personal-pop.example'");
  });

  it('installs Node when necessary and invokes the Windows npm launcher', () => {
    const script = windowsInstaller('https://pop.example', '1.2.3');

    expect(script).toContain("$minimumNodeVersion = [Version]'22.19.0'");
    expect(script).toContain('winget.Source install --id OpenJS.NodeJS.LTS');
    expect(script).toContain("'npm.cmd'");
    expect(script).toContain('& $npmPath install --global $packageUrl');
    expect(script).toContain('& $popPath --version');
    expect(script).toContain('Next: pop login $serverOrigin');
  });

  it('quotes values embedded in PowerShell literals', () => {
    const script = windowsInstaller("https://pop.example/a'b", "1.2.3'x");

    expect(script).toContain("$serverOrigin = 'https://pop.example/a''b'");
    expect(script).toContain("$cliVersion = '1.2.3''x'");
  });
});
