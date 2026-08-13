import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OAuthCooldownStore } from '../../application/ports/oauth-cooldown-store.js';

interface CooldownFile {
  version: 1;
  cooldowns: Record<string, number>;
}

/**
 * Tiny durable brake for OAuth rate limits. It stores deadlines, not auth data,
 * and writes atomically so a power loss degrades to "no cooldown", never a
 * broken server. Invalid or stale files are ignored.
 */
export class FileOAuthCooldownStore implements OAuthCooldownStore {
  constructor(private readonly path: string) {}

  get(providerId: string): number | undefined {
    const value = this.read().cooldowns[providerId];
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? value
      : undefined;
  }

  set(providerId: string, until: number | undefined): void {
    const current = this.read();
    if (until === undefined) {
      if (current.cooldowns[providerId] === undefined) return;
      delete current.cooldowns[providerId];
    } else {
      current.cooldowns[providerId] = until;
    }
    this.write(current);
  }

  private read(): CooldownFile {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
      if (parsed === null || typeof parsed !== 'object') return emptyFile();
      const record = parsed as { version?: unknown; cooldowns?: unknown };
      if (record.version !== 1 || record.cooldowns === null || typeof record.cooldowns !== 'object') {
        return emptyFile();
      }
      const cooldowns: Record<string, number> = {};
      for (const [providerId, value] of Object.entries(record.cooldowns)) {
        if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) {
          cooldowns[providerId] = value;
        }
      }
      return { version: 1, cooldowns };
    } catch {
      return emptyFile();
    }
  }

  private write(value: CooldownFile): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${String(process.pid)}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

function emptyFile(): CooldownFile {
  return { version: 1, cooldowns: {} };
}
