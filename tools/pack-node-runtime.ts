import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface SourcePackage {
  sourceUrl: string;
  file: string;
  size: number;
  sha256: string;
}

interface SourceRelease {
  version: string;
  minimumLauncherVersion: string;
  packages: Record<string, SourcePackage>;
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = JSON.parse(
  readFileSync(join(root, 'tools', 'node-runtime-release.json'), 'utf8'),
) as SourceRelease;
const output = join(root, 'cli', 'pack', 'runtime', 'node');

function validHash(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

async function download(url: string, destination: string, expectedSize: number): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || response.body === null) {
    throw new Error(`Node runtime download returned HTTP ${response.status}`);
  }
  if (response.url !== url) throw new Error('Node runtime download was redirected');
  if (Number(response.headers.get('content-length')) !== expectedSize) {
    throw new Error('Node runtime Content-Length does not match pinned release metadata');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length !== expectedSize) throw new Error('Node runtime download size mismatch');
  writeFileSync(destination, bytes, { mode: 0o600 });
}

async function main(): Promise<void> {
  if (!/^\d+\.\d+\.\d+$/.test(source.version)) throw new Error('invalid Node runtime version');
  if (!/^\d+\.\d+\.\d+$/.test(source.minimumLauncherVersion)) {
    throw new Error('invalid minimum launcher version');
  }
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });

  const packages: Record<string, { sourceUrl: string; file: string; size: number; sha256: string }> = {};
  for (const [target, artifact] of Object.entries(source.packages)) {
    if (!/^[a-z]+-(?:arm64|amd64)$/.test(target)) throw new Error(`invalid runtime target ${target}`);
    if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
      throw new Error(`invalid runtime size for ${target}`);
    }
    if (!validHash(artifact.sha256)) throw new Error(`invalid runtime checksum for ${target}`);
    if (artifact.file.includes('/') || artifact.file.includes('\\')) {
      throw new Error(`invalid runtime filename for ${target}`);
    }
    const parsed = new URL(artifact.sourceUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'nodejs.org') {
      throw new Error(`runtime source for ${target} is not an official nodejs.org URL`);
    }
    const destination = join(output, artifact.file);
    const temporary = `${destination}.tmp`;
    rmSync(temporary, { force: true });
    try {
      await download(artifact.sourceUrl, temporary, artifact.size);
      const bytes = readFileSync(temporary);
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== artifact.sha256) {
        throw new Error(`Node runtime checksum mismatch for ${target}: got ${actual}`);
      }
      renameSync(temporary, destination);
    } finally {
      rmSync(temporary, { force: true });
    }
    packages[target] = {
      sourceUrl: artifact.sourceUrl,
      file: artifact.file,
      size: artifact.size,
      sha256: artifact.sha256,
    };
  }

  writeFileSync(
    join(output, 'manifest.json'),
    `${JSON.stringify({
      version: source.version,
      minimumLauncherVersion: source.minimumLauncherVersion,
      packages,
    }, undefined, 2)}\n`,
  );
  process.stdout.write(`packed managed Node runtime ${source.version}\n`);
}

await main();
