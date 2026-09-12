import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CliPreferences, PreferenceStore } from '../application/preferences.js';

/** Device-local UI preferences at `$XDG_CONFIG_HOME/pop-agent/preferences.json`. */
export class FilePreferenceStore implements PreferenceStore {
  constructor(private readonly path = defaultPreferencePath()) {}

  read(): Partial<CliPreferences> {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown;
      if (typeof parsed !== 'object' || parsed === null) return {};
      const showThinking = (parsed as { showThinking?: unknown }).showThinking;
      return typeof showThinking === 'boolean' ? { showThinking } : {};
    } catch {
      return {};
    }
  }

  write(preferences: CliPreferences): void {
    const dir = join(this.path, '..');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    writeFileSync(this.path, `${JSON.stringify(preferences, null, 2)}\n`, { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}

export function defaultPreferencePath(): string {
  const xdg = process.env['XDG_CONFIG_HOME'];
  const base = xdg !== undefined && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'pop-agent', 'preferences.json');
}
