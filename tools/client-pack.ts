import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
interface Entry {
    file: string;
    size: number;
    sha256: string;
}
interface Source {
    repository: string;
    version: string;
}
interface Snapshot {
    cliVersion: string;
    files: Record<string, Entry>;
    sources?: Record<string, Source>;
    source: Source;
}
export interface ClientPack {
    version: string;
    digest: string;
    files: Record<string, Buffer>;
    tarball: Entry;
}
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const versionPattern = /^\d+\.\d+\.\d+$/;
const validSource = (s: Source | undefined): s is Source => !!s && /^[\w.-]+\/[\w.-]+$/.test(s.repository) && versionPattern.test(s.version);
/** No downloads or native probes. A missing ignored build directory must block activation. */
export function validateClientPack(root: string, mode: 'complete' | 'lazy' = 'lazy'): ClientPack {
    const pack = join(root, 'cli/pack');
    const files: Record<string, Buffer> = {};
    const read = (name: string): Buffer => {
        if (name.split('/').some(p => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(p)))
            throw Error(`Unsafe client path: ${name}`);
        let path = root;
        for (const part of ['cli', 'pack', ...name.split('/')]) {
            path = join(path, part);
            if (lstatSync(path).isSymbolicLink())
                throw Error(`Client path is a symlink: ${path}`);
        }
        if (!lstatSync(path).isFile() || lstatSync(path).size > 128 * 1024 * 1024)
            throw Error(`Invalid client file: ${name}`);
        return files[name] = readFileSync(path);
    };
    const version = (JSON.parse(read('package.json').toString()) as {
        version: string;
    }).version;
    if (!versionPattern.test(version))
        throw Error('Invalid CLI version');
    const tarName = `cli-${version}.tgz`;
    const tar = read(tarName);
    if (!tar.length)
        throw Error('Empty CLI tarball');
    const catalog = mode === 'lazy' ? JSON.parse(read('client-downloads.json').toString()) as {
        schema?: number;
        artifacts?: Record<string, Source>;
        repository?: string;
        version?: string;
    } : undefined;
    const required = ['package.json', tarName, 'launcher/manifest.json', 'local-access/manifest.json', 'runtime/node/manifest.json'];
    const lockPath = join(root, 'release/clients.json');
    const pinned = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, 'utf8')) as Snapshot : undefined;
    let snapshot: Snapshot | undefined;
    if (existsSync(join(pack, 'client-release.json'))) {
        snapshot = JSON.parse(read('client-release.json').toString()) as Snapshot;
        if (lstatSync(lockPath).isSymbolicLink() || !isDeepStrictEqual(snapshot, JSON.parse(readFileSync(lockPath, 'utf8'))))
            throw Error('Client snapshot differs from release/clients.json');
        if (snapshot.cliVersion !== version || !isDeepStrictEqual(Object.keys(snapshot.files).sort(), [...required].sort()))
            throw Error('Incomplete pinned client snapshot');
    }
    let built: { schema: number; mode: string; files: Record<string, string> } | undefined;
    if (!snapshot && mode === 'lazy' && existsSync(join(pack, 'client-build.json'))) {
        built = JSON.parse(read('client-build.json').toString());
        if (built?.schema !== 1 || built.mode !== 'complete-build' || !isDeepStrictEqual(Object.keys(built.files).sort(), [...required, 'client-downloads.json'].sort())) throw Error('Invalid complete-build client proof');
    }
    if (!snapshot && mode === 'lazy' && pinned && !built) throw Error('Client distribution requires its release snapshot or complete-build proof');
    const expectedSources: Record<string, Source> = {};
    for (const category of ['launcher', 'local-access', 'runtime/node']) {
        const name = `${category}/manifest.json`;
        const manifest = JSON.parse(read(name).toString()) as {
            version: string;
            artifacts?: Record<string, Entry>;
            packages?: Record<string, Entry>;
        };
        if (!versionPattern.test(manifest.version))
            throw Error(`Invalid manifest version: ${name}`);
        const entries = Object.values(manifest.artifacts ?? manifest.packages ?? {});
        if (!entries.length)
            throw Error(`Empty client manifest: ${name}`);
        const seen = new Set<string>();
        for (const entry of entries) {
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(entry.file) || seen.has(entry.file) || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > 128 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(entry.sha256))
                throw Error(`Invalid client artifact: ${name}`);
            seen.add(entry.file);
            const key = `${category}/${entry.file}`;
            if (mode === 'complete') {
                const bytes = read(key);
                if (bytes.length !== entry.size || hash(bytes) !== entry.sha256)
                    throw Error(`Client artifact failed verification: ${key}`);
            }
            else if (category !== 'runtime/node') {
                const source = catalog?.schema === 2 ? catalog.artifacts?.[key] : catalog as Source | undefined;
                if (!validSource(source))
                    throw Error(`Missing client source: ${key}`);
                if (snapshot) {
                    const pinned = snapshot.sources ? snapshot.sources[key] : snapshot.source;
                    if (!isDeepStrictEqual(source, pinned))
                        throw Error(`Client source differs from pinned release: ${key}`);
                }
                expectedSources[key] = source;
            }
        }
    }
    if (catalog?.schema === 2 && !isDeepStrictEqual(catalog.artifacts, expectedSources))
        throw Error('Unexpected client catalog entries');
    if (snapshot)
        for (const name of required) {
            const entry = snapshot.files[name]!;
            const bytes = files[name]!;
            if (entry.file !== name.split('/').at(-1) || entry.size !== bytes.length || entry.sha256 !== hash(bytes))
                throw Error(`Client snapshot checksum mismatch: ${name}`);
        }
    // CLI immutability is independent of native component versions.
    if (pinned?.cliVersion === version) for (const name of ['package.json', tarName]) {
        const entry = pinned.files[name];
        if (!entry || entry.size !== files[name]!.length || entry.sha256 !== hash(files[name]!)) throw Error(`Pinned CLI checksum mismatch: ${name}`);
    }
    if (built) for (const [name, digest] of Object.entries(built.files)) {
        if (hash(files[name]!) !== digest) throw Error(`Complete-build client proof mismatch: ${name}`);
    }
    const digest = hash(Object.keys(files).sort().map(name => `${name}:${hash(files[name]!)}\n`).join(''));
    return { version, digest, files, tarball: { file: tarName, size: tar.length, sha256: hash(tar) } };
}
/** Written only after verifying all newly built native bytes, before lazy packaging removes them. */
export function recordCompleteClientBuild(root: string): void {
    const pack = validateClientPack(root, 'complete');
    const names = ['package.json', pack.tarball.file, 'launcher/manifest.json', 'local-access/manifest.json', 'runtime/node/manifest.json'];
    const files = Object.fromEntries(names.map(name => [name, hash(pack.files[name]!)]));
    const catalog = join(root, 'cli/pack/client-downloads.json');
    if (!lstatSync(catalog).isFile() || lstatSync(catalog).isSymbolicLink()) throw Error('Missing generated client catalog');
    files['client-downloads.json'] = hash(readFileSync(catalog));
    writeFileSync(join(root, 'cli/pack/client-build.json'), JSON.stringify({schema: 1, mode: 'complete-build', files}) + '\n');
}

/** Bounded, credential-free bootstrap check against the selected on-disk snapshot. */
export async function verifyClientBootstrap(origin: string, pack: ClientPack, http: typeof fetch = fetch): Promise<void> {
    const get = async (path: string, limit: number) => {
        const response = await http(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(10000) });
        if (response.status !== 200 || !response.body)
            throw Error(`Client bootstrap ${path}: HTTP ${response.status}`);
        const chunks: Uint8Array[] = [];
        let size = 0;
        const reader = response.body.getReader();
        try {
            for (;;) {
                const { value, done } = await reader.read();
                if (done)
                    break;
                size += value.length;
                if (size > limit)
                    throw Error(`Oversized bootstrap response: ${path}`);
                chunks.push(value);
            }
        }
        finally {
            await reader.cancel();
        }
        return Buffer.concat(chunks);
    };
    for (const [route, name] of [
        ['/cli/launcher/manifest.json', 'launcher/manifest.json'],
        ['/runtime/node/manifest.json', 'runtime/node/manifest.json'],
    ] as const) {
        const body = await get(route, 256 * 1024);
        if (!isDeepStrictEqual(JSON.parse(body.toString()), JSON.parse(pack.files[name]!.toString())))
            throw Error(`Bootstrap manifest mismatch: ${route}`);
    }
    const local = JSON.parse(pack.files['local-access/manifest.json']!.toString()) as {
        version: string;
        artifacts: Record<string, Entry>;
    };
    const setup = local.artifacts['windows-amd64-setup'];
    if (!setup)
        throw Error('Missing Windows Local Access installer');
    const update = JSON.parse((await get('/local-access-update.json?platform=windows&arch=amd64', 256 * 1024)).toString());
    if (!isDeepStrictEqual(update, { version: local.version, ...setup }))
        throw Error('Local Access bootstrap metadata mismatch');
    const cli = JSON.parse((await get('/cli/manifest.json', 256 * 1024)).toString()) as {
        version: string;
        package: {
            url: string;
            size: number;
            sha256: string;
        };
    };
    if (cli.version !== pack.version || cli.package.url !== `/${pack.tarball.file}` || cli.package.size !== pack.tarball.size || cli.package.sha256 !== pack.tarball.sha256)
        throw Error('CLI bootstrap metadata mismatch');
    const tar = await get(cli.package.url, pack.tarball.size);
    if (tar.length !== pack.tarball.size || hash(tar) !== pack.tarball.sha256)
        throw Error('CLI bootstrap tarball checksum mismatch');
}
