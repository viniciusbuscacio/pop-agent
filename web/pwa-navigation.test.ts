import { describe, expect, it } from 'vitest';
import { navigationFallbackDenylist } from './pwa-navigation';

const bypassesShell = (path: string) => navigationFallbackDenylist.some(pattern => pattern.test(path));

describe('PWA navigation fallback', () => {
  it.each([
    '/local-access-installer?platform=windows&arch=amd64',
    '/local-access-installer?platform=darwin&arch=arm64',
    '/local-access/pop-local-access-0.2.89-windows-amd64-setup.exe',
    '/local-access/pop-local-access-0.2.89-darwin-arm64-setup.dmg',
    '/local-access-update.json?platform=windows&arch=amd64',
    '/install.sh', '/install.ps1', '/install-local-access.sh', '/install-local-access.ps1',
    '/cli/manifest.json', '/cli/launcher/pop-launcher-1.1.5-windows-amd64.exe',
    '/cli-latest.tgz', '/cli-0.2.89.tgz',
    '/runtime/node/manifest.json', '/runtime/node/22.23.2/node.zip',
    '/files/download?path=manual.pdf&sig=example', '/v1/health', '/healthz',
    '/settings?section=installation&_pop_refresh=123',
  ])('keeps %s on the network, including both installer redirect hops', path => {
    expect(bypassesShell(path)).toBe(true);
  });

  it.each([
    '/', '/login', '/settings?section=installation', '/settings?section=devices',
    '/chat/chat-example', '/files', '/files/manual.pdf', '/a2a/new', '/mcp/new',
    '/local-access-installer-not-a-download',
  ])('preserves the offline application shell for %s', path => {
    expect(bypassesShell(path)).toBe(false);
  });
});
