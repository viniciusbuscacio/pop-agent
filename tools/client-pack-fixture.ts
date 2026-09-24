import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
export function clientPackFixture(root: string): void {
    const put = (name: string, value: string) => { const p = join(root, name); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, value); };
    const contents: Record<string, string> = { 'package.json': '{"version":"1.0.0"}', 'cli-1.0.0.tgz': 'test-cli' };
    const artifact = { file: 'native.bin', size: 4, sha256: createHash('sha256').update('test').digest('hex') };
    const source = { repository: 'owner/repo', version: '1.0.0' };
    const sources: Record<string, typeof source> = {};
    for (const category of ['launcher', 'local-access', 'runtime/node']) {
        contents[`${category}/manifest.json`] = JSON.stringify({ version: '1.0.0', artifacts: { 'windows-amd64-setup': artifact } });
        if (category !== 'runtime/node')
            sources[`${category}/native.bin`] = source;
    }
    const files = Object.fromEntries(Object.entries(contents).map(([name, bytes]) => [name, { file: name.split('/').at(-1), size: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') }]));
    const lock = { schema: 1, cliVersion: '1.0.0', source, sources, files };
    for (const [name, bytes] of Object.entries(contents))
        put(`cli/pack/${name}`, bytes);
    put('release/clients.json', JSON.stringify(lock));
    put('cli/pack/client-release.json', JSON.stringify(lock));
    put('cli/pack/client-downloads.json', JSON.stringify({ schema: 2, artifacts: sources }));
}
