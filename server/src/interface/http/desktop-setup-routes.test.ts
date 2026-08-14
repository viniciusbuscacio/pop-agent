import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventTickets } from './event-tickets.js';
import {
  createDesktopSetupDownloadRoutes,
  createDesktopSetupReleaseRoutes,
} from './desktop-setup-routes.js';

class FakeClock {
  value = 1_000;
  now = () => this.value;
}

describe('Pop Desktop Setup distribution', () => {
  let pack: string;
  let clock: FakeClock;
  let tickets: EventTickets;

  beforeEach(() => {
    pack = mkdtempSync(join(tmpdir(), 'pop-desktop-setup-'));
    clock = new FakeClock();
    tickets = new EventTickets(clock, 60_000);
  });

  afterEach(() => rmSync(pack, { recursive: true, force: true }));

  function publish(): Uint8Array {
    const bytes = new TextEncoder().encode('immutable setup dmg');
    const file = 'pop-desktop-setup-0.2.27-darwin-arm64.dmg';
    writeFileSync(join(pack, file), bytes);
    writeFileSync(
      join(pack, 'setup-release.json'),
      JSON.stringify({
        version: '0.2.27',
        platform: 'darwin',
        arch: 'arm64',
        file,
        sha256: 'a'.repeat(64),
        size: bytes.length,
      }),
    );
    return bytes;
  }

  it('trades an authenticated request for a one-use byte-stream ticket', async () => {
    const bytes = publish();
    const guarded = createDesktopSetupReleaseRoutes({ desktopPack: pack, tickets });
    const publicRoutes = createDesktopSetupDownloadRoutes({ desktopPack: pack, tickets });

    const metadata = await guarded.request('/desktop/setup/release');
    expect(metadata.status).toBe(200);
    expect(await metadata.json()).toMatchObject({ version: '0.2.27', size: bytes.length });

    const ticketResponse = await guarded.request('/desktop/setup/ticket', { method: 'POST' });
    expect(ticketResponse.status).toBe(200);
    const ticket = (await ticketResponse.json()) as { downloadPath: string };
    expect(ticket.downloadPath).not.toContain('Bearer');

    const download = await publicRoutes.request(ticket.downloadPath);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toBe('attachment; filename="Pop Desktop Setup.dmg"');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
    expect((await publicRoutes.request(ticket.downloadPath)).status).toBe(404);
  });

  it('expires unused tickets and does not issue one without a valid release', async () => {
    const guarded = createDesktopSetupReleaseRoutes({ desktopPack: pack, tickets });
    expect((await guarded.request('/desktop/setup/ticket', { method: 'POST' })).status).toBe(404);

    publish();
    const response = await guarded.request('/desktop/setup/ticket', { method: 'POST' });
    const { downloadPath } = (await response.json()) as { downloadPath: string };
    clock.value += 60_001;
    const publicRoutes = createDesktopSetupDownloadRoutes({ desktopPack: pack, tickets });
    expect((await publicRoutes.request(downloadPath)).status).toBe(404);
  });
});
