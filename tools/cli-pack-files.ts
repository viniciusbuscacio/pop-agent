import { lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ARCHIVE = /^cli-\d+\.\d+\.\d+\.tgz$/;

/**
 * Clears mutable pack output while retaining immutable historical CLI releases.
 * Unsafe lookalikes (including symlinks) are not release artifacts and are removed.
 */
export function prepareCliPackDirectory(out: string): void {
  try {
    if (!lstatSync(out).isDirectory()) throw new Error('CLI pack path is not a real directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    mkdirSync(out, { recursive: true });
  }
  for (const name of readdirSync(out)) {
    const path = join(out, name);
    if (CLI_ARCHIVE.test(name) && lstatSync(path).isFile()) continue;
    rmSync(path, { recursive: true, force: true });
  }
}

/** Publishes a newly packed CLI without ever replacing different immutable bytes. */
export function publishCliArchive(out: string, version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`invalid CLI version: ${version}`);
  const packed = join(out, `pop-agent-${version}.tgz`);
  if (!lstatSync(packed).isFile()) throw new Error('npm pack produced no regular tarball');

  const servedName = `cli-${version}.tgz`;
  const served = join(out, servedName);
  try {
    if (!lstatSync(served).isFile()) throw new Error(`immutable CLI artifact is not a regular file: ${servedName}`);
    const candidate = readFileSync(packed);
    const existing = readFileSync(served);
    rmSync(packed);
    if (!candidate.equals(existing)) {
      throw new Error(`refusing to replace immutable CLI artifact: ${servedName}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    renameSync(packed, served);
  }
  return servedName;
}
