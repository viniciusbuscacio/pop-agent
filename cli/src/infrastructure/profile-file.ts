import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Profile, ProfileStore } from '../application/profiles.js';

/**
 * Profiles on disk, at `$XDG_CONFIG_HOME/popy/profiles.json` (docs/cli.md).
 *
 * 0700 on the directory and 0600 on the file, set explicitly rather than left
 * to the umask: the file holds a full-access session token, and a laptop runs
 * more other people's code than a server does. `mkdirSync`'s mode is filtered
 * by the umask, so the chmod afterwards is what actually guarantees it.
 *
 * A missing or unreadable file reads as "no profiles". `popy login` is then
 * the obvious next step, which is a better answer than a stack trace about
 * JSON.
 */
export class FileProfileStore implements ProfileStore {
  constructor(private readonly path = defaultProfilePath()) {}

  read(): Record<string, Profile> {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as Record<string, Profile>;
      return typeof parsed === 'object' && parsed !== null ? parsed : {};
    } catch {
      return {};
    }
  }

  write(profiles: Record<string, Profile>): void {
    const dir = join(this.path, '..');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    writeFileSync(this.path, `${JSON.stringify(profiles, null, 2)}\n`, { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}

export function defaultProfilePath(): string {
  const xdg = process.env['XDG_CONFIG_HOME'];
  const base = xdg !== undefined && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'popy', 'profiles.json');
}
