import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { ClientArtifactProvider } from '../../application/ports/client-artifacts.js';

const execute = promisify(execFile);
type Category = Parameters<ClientArtifactProvider['ensure']>[0];
interface Artifact { file: string; size: number; sha256: string; sourceUrl?: string }
interface Source { repository: string; version: string }
interface SourceCatalog { schema: 2; artifacts: Record<string, Source> }
export interface ClientArtifactDownloader {
  download(artifact: Artifact, source: Source | undefined, category: Category, destination: string): Promise<void>;
}

export class HttpClientArtifactDownloader implements ClientArtifactDownloader {
  async download(artifact: Artifact, source: Source | undefined, category: Category, destination: string): Promise<void> {
    if (category !== 'node' && source !== undefined) {
      try {
        await execute('gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 10_000 });
        await execute('gh', ['release', 'download', `v${source.version}`, '--repo', source.repository,
          '--pattern', artifact.file, '--output', destination], { timeout: 300_000, maxBuffer: 64 * 1024 });
        return;
      } catch {
        // Public releases also work without gh; never expose credential-tool output.
        await rm(destination, { force: true });
      }
    }
    const url = category === 'node' ? artifact.sourceUrl
      : source === undefined ? undefined : `https://github.com/${source.repository}/releases/download/v${source.version}/${artifact.file}`;
    if (url === undefined) throw new Error('Client release source is unavailable');
    const response = await fetch(url, { signal: AbortSignal.timeout(300_000), redirect: 'follow' });
    if (!response.ok || response.body === null || new URL(response.url).protocol !== 'https:') throw new Error('Client release download failed');
    let size = 0;
    const limit = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      callback(size > artifact.size ? new Error('Client release exceeds its declared size') : null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  }
}

/** Fixed manifests, verified staging and hash-addressed durable storage. No startup downloads. */
export class LazyClientArtifacts implements ClientArtifactProvider {
  private readonly inflight = new Map<string, Promise<string | undefined>>();
  constructor(private readonly pack: string, private readonly cache: string,
    private readonly downloader: ClientArtifactDownloader = new HttpClientArtifactDownloader()) {}

  async ensure(category: Category, file: string): Promise<string | undefined> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]+$/.test(file)) return undefined;
    const key = `${category}/${file}`;
    let pending = this.inflight.get(key);
    if (pending === undefined) {
      pending = this.acquire(category, file).catch(() => undefined).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }
    return pending;
  }

  private async acquire(category: Category, file: string): Promise<string | undefined> {
    const directory = category === 'node' ? join(this.pack, 'runtime/node') : join(this.pack, category);
    const release = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as {
      version: string; artifacts?: Record<string, Artifact>; packages?: Record<string, Artifact>;
    };
    const artifact = Object.values(release.artifacts ?? release.packages ?? {}).find((entry) => entry.file === file);
    if (artifact === undefined || !Number.isSafeInteger(artifact.size) || artifact.size <= 0 || artifact.size > 128 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(artifact.sha256)) return undefined;
    if (category === 'node' && (!/^\d+\.\d+\.\d+$/.test(release.version)
      || artifact.sourceUrl !== `https://nodejs.org/dist/v${release.version}/${file}`)) return undefined;
    const local = join(directory, file);
    if (await verified(local, artifact)) return local;
    let source: Source | undefined;
    if (category !== 'node') {
      const catalog = JSON.parse(await readFile(join(this.pack, 'client-downloads.json'), 'utf8')) as Source | SourceCatalog;
      source = 'schema' in catalog && catalog.schema === 2 ? catalog.artifacts?.[`${category}/${file}`] : catalog as Source;
      if (!source) return undefined;
      if (!/^[\w.-]+\/[\w.-]+$/.test(source.repository) || !/^\d+\.\d+\.\d+$/.test(source.version)) return undefined;
    }
    await mkdir(this.cache, { recursive: true, mode: 0o700 });
    const info = await lstat(this.cache);
    if (!info.isDirectory() || (info.mode & 0o077) !== 0 || (process.getuid !== undefined && info.uid !== process.getuid())) throw new Error('Unsafe client cache');
    const destination = join(this.cache, `${artifact.sha256}-${file}`);
    if (await verified(destination, artifact)) return destination;
    const temporary = join(this.cache, `.${randomUUID()}.tmp`);
    try {
      await this.downloader.download(artifact, source, category, temporary);
      if (!(await verified(temporary, artifact))) throw new Error('Client release integrity verification failed');
      await rename(temporary, destination);
      return destination;
    } finally { await rm(temporary, { force: true }); }
  }
}

async function verified(path: string, artifact: Artifact): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size !== artifact.size) return false;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('hex') === artifact.sha256;
  } catch { return false; }
}
