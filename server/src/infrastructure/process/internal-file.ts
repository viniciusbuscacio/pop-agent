import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomFileName } from '../../domain/ids.js';

const MAX_COLLISION_RETRIES = 8;

type FileContents = string | NodeJS.ArrayBufferView;

/**
 * Claims a Pop-owned internal filename without ever replacing an existing
 * file. A CSPRNG collision is extraordinarily unlikely, but the safety
 * behavior is deterministic: redraw on EEXIST and propagate every other I/O
 * failure.
 */
export function createExclusiveInternalFile(
  dir: string,
  prefix: string,
  extension: string,
  contents: FileContents = '',
  nextName: (prefix: string, extension: string) => string = randomFileName,
): string {
  for (let attempt = 0; attempt <= MAX_COLLISION_RETRIES; attempt += 1) {
    const path = join(dir, nextName(prefix, extension));
    try {
      writeFileSync(path, contents, { flag: 'wx', mode: 0o600 });
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error(`could not claim a unique internal ${prefix} file`);
}
