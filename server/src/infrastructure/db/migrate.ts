import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Db } from './types.js';

/**
 * Migration runner (docs/specs/Spec-Pop-Backend.md §6). Strictly named,
 * uniquely versioned .sql files apply in order, each inside its own transaction,
 * and are recorded in schema_migrations so a restart is a no-op. Deliberately
 * not a library: owning the runner keeps the schema readable as plain SQL.
 */

// Resolved relative to this module so it works both from src/ (tsx, dev) and
// from dist/ (compiled) -- both sit three levels below the server workspace.
const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../../migrations/', import.meta.url));

export function migrate(db: Db, dir: string = DEFAULT_MIGRATIONS_DIR): number {
  // Validate the whole directory before touching the database. In particular,
  // two files with one version must not apply the first and fail only after it
  // has committed.
  const files = migrationFiles(dir);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const rows = db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[];
  const applied = new Set(rows.map((row) => row.version));

  let count = 0;
  for (const { file, version } of files) {
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

function migrationFiles(dir: string): { file: string; version: number }[] {
  const seen = new Map<number, string>();
  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .map((file) => {
      const version = versionOf(file);
      const previous = seen.get(version);
      if (previous !== undefined) {
        throw new Error(`duplicate migration version ${String(version)}: ${previous}, ${file}`);
      }
      seen.set(version, file);
      return { file, version };
    });
  return files.sort((left, right) => left.version - right.version);
}

function versionOf(file: string): number {
  const match = /^(\d{3})_[a-z0-9][a-z0-9_]*\.sql$/.exec(file);
  if (match?.[1] === undefined) {
    throw new Error(`migration file must be named NNN_descriptive_name.sql, got: ${file}`);
  }
  return Number(match[1]);
}
