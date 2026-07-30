import Database from 'better-sqlite3';
import { migrate } from './migrate.js';
import type { Db } from './types.js';

/**
 * Opens popy.db and brings the schema up to date. WAL is on because the server
 * reads while it writes; foreign keys are on because SQLite otherwise ignores
 * them silently.
 */
export function openDatabase(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
