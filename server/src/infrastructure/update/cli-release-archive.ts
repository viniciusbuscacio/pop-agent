import { copyFileSync, constants, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const CLI_ARCHIVE = /^cli-\d+\.\d+\.\d+\.tgz$/;

/**
 * Copies checkout-local CLI releases into durable product data before serving.
 * Existing versioned bytes are immutable: a conflicting rebuild fails closed.
 */
export function archiveCliReleases(source: string, archive: string): void {
  try {
    if (!lstatSync(archive).isDirectory()) throw new Error('CLI release archive is not a real directory');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    mkdirSync(archive, { recursive: true, mode: 0o700 });
  }

  let names: string[];
  try {
    names = readdirSync(source).filter((name) => CLI_ARCHIVE.test(name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  for (const name of names) {
    const from = join(source, name);
    if (!lstatSync(from).isFile()) continue;
    const to = join(archive, name);
    try {
      copyFileSync(from, to, constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!lstatSync(to).isFile() || !readFileSync(from).equals(readFileSync(to))) {
        throw new Error(`refusing conflicting immutable CLI release: ${name}`);
      }
    }
  }

  // No temporary files are expected today; reserve cleanup for interrupted
  // future atomic publication without touching exact release names.
  for (const name of readdirSync(archive)) {
    if (name.startsWith('.cli-') && name.endsWith('.tmp')) rmSync(join(archive, name), { force: true });
  }
}
