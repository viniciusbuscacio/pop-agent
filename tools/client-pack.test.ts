import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { validateClientPack, verifyClientBootstrap, recordCompleteClientBuild } from './client-pack.ts';
import { clientPackFixture } from './client-pack-fixture.ts';
const roots: string[] = [];
function fixture() { const root = mkdtempSync(join(tmpdir(), 'pop-client-pack-')); roots.push(root); clientPackFixture(root); return root; }
afterEach(() => { for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true }); });
describe('client activation contract', () => {
    it('accepts pinned lazy clients without downloading native binaries', () => { expect(validateClientPack(fixture()).version).toBe('1.0.0'); });
    it.each(['package.json', 'launcher/manifest.json', 'local-access/manifest.json', 'runtime/node/manifest.json', 'cli-1.0.0.tgz', 'client-downloads.json'])('rejects missing %s', name => {
        const root = fixture();
        rmSync(join(root, 'cli/pack', name));
        expect(() => validateClientPack(root)).toThrow();
    });
    it('rejects a reuse catalog with the snapshot removed', () => {
        const root = fixture();
        rmSync(join(root, 'cli/pack/client-release.json'));
        expect(() => validateClientPack(root)).toThrow('requires its release snapshot');
    });
    it('cannot downgrade a pinned version by replacing its catalog with legacy metadata', () => {
        const root = fixture();
        rmSync(join(root, 'cli/pack/client-release.json'));
        writeFileSync(join(root, 'cli/pack/client-downloads.json'), JSON.stringify({ repository: 'owner/repo', version: '1.0.0' }));
        expect(() => validateClientPack(root)).toThrow('requires its release snapshot');
    });
    it('allows a new native release with unchanged pinned CLI bytes, then verifies its lazy proof', () => {
        const root = fixture();
        rmSync(join(root, 'cli/pack/client-release.json'));
        const path = join(root, 'cli/pack/local-access/manifest.json');
        const manifest = JSON.parse(readFileSync(path, 'utf8')); manifest.version = '2.0.0'; writeFileSync(path, JSON.stringify(manifest));
        for (const category of ['launcher', 'local-access', 'runtime/node']) writeFileSync(join(root, 'cli/pack', category, 'native.bin'), 'test');
        recordCompleteClientBuild(root);
        for (const category of ['launcher', 'local-access', 'runtime/node']) rmSync(join(root, 'cli/pack', category, 'native.bin'));
        expect(validateClientPack(root).version).toBe('1.0.0');
        writeFileSync(path, '{}'); expect(() => validateClientPack(root)).toThrow();
    });
    it('rejects same-sized tampering with the CLI tarball', () => {
        const root = fixture();
        writeFileSync(join(root, 'cli/pack/cli-1.0.0.tgz'), 'evil-cli');
        expect(() => validateClientPack(root)).toThrow('checksum');
    });
    it('rejects a catalog pointing to a different release', () => {
        const root = fixture();
        const p = join(root, 'cli/pack/client-downloads.json');
        writeFileSync(p, readFileSync(p, 'utf8').replaceAll('owner/repo', 'evil/repo'));
        expect(() => validateClientPack(root)).toThrow('pinned');
    });
    it('rejects symlinked parent directories', () => {
        const root = fixture();
        rmSync(join(root, 'cli/pack/launcher'), { recursive: true });
        mkdirSync(join(root, 'elsewhere'));
        symlinkSync(join(root, 'elsewhere'), join(root, 'cli/pack/launcher'));
        expect(() => validateClientPack(root)).toThrow('symlink');
    });
    it('requires native bytes for complete packs without a reuse snapshot', () => {
        const root = fixture();
        rmSync(join(root, 'cli/pack/client-release.json'));
        rmSync(join(root, 'release/clients.json'));
        expect(() => validateClientPack(root, 'complete')).toThrow();
        for (const category of ['launcher', 'local-access', 'runtime/node'])
            writeFileSync(join(root, 'cli/pack', category, 'native.bin'), 'test');
        expect(validateClientPack(root, 'complete').version).toBe('1.0.0');
    });
    it.each(['good', '404', 'manifest', 'tarball', 'oversized', 'cross-origin'])('verifies bounded HTTP bootstrap: %s', async (outcome) => {
        const pack = validateClientPack(fixture());
        const fake: typeof fetch = async (input, init) => {
            expect(init?.redirect).toBe('error');
            const path = new URL(String(input)).pathname;
            if (outcome === '404')
                return new Response('missing', { status: 404 });
            if (path === '/local-access-update.json') {
                const m = JSON.parse(pack.files['local-access/manifest.json']!.toString());
                return Response.json({ version: m.version, ...m.artifacts['windows-amd64-setup'] });
            }
            if (path === '/cli/manifest.json')
                return Response.json({ version: pack.version, package: { url: outcome === 'cross-origin' ? 'https://other/evil.tgz' : '/cli-1.0.0.tgz', size: pack.tarball.size, sha256: pack.tarball.sha256 } });
            if (path.endsWith('.tgz'))
                return new Response(outcome === 'tarball' ? 'evil-cli' : outcome === 'oversized' ? 'test-cli-too-large' : 'test-cli');
            const name = path.replace(/^\/cli\//, '').replace(/^\//, '');
            return new Response(outcome === 'manifest' ? '{}' : pack.files[name]!.toString());
        };
        if (outcome === 'good')
            await expect(verifyClientBootstrap('http://127.0.0.1:8787', pack, fake)).resolves.toBeUndefined();
        else
            await expect(verifyClientBootstrap('http://127.0.0.1:8787', pack, fake)).rejects.toThrow();
    });
});
