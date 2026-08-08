import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './types.js';

/**
 * Migration runner (pop-agent.spec §6). Numbered .sql files, applied in order, each
 * inside its own transaction, recorded in schema_migrations so a restart is a
 * no-op. Deliberately not a library: the whole contract is "run the files that
 * have not run yet", and owning it keeps the schema readable as plain SQL.
 */

// Resolved relative to this module so it works both from src/ (tsx, dev) and
// from dist/ (compiled) -- both sit three levels below the server workspace.
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations/', import.meta.url));

export function migrate(db: Db, dir: string = DEFAULT_MIGRATIONS_DIR): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  const applied = new Set(rows.map((row) => row.version));

  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    const version = versionOf(file);
    if (applied.has(version)) continue;

    const sql = readFileSync(join(dir, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        version,
        new Date().toISOString(),
      );
    });
    apply();
    count += 1;
  }
  return count;
}

function versionOf(file: string): number {
  const match = /^(\d+)_/.exec(file);
  if (match?.[1] === undefined) {
    throw new Error(`migration file must be named <number>_<name>.sql, got: ${file}`);
  }
  return Number(match[1]);
}
