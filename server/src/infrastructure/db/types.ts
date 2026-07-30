import type Database from 'better-sqlite3';

/**
 * The concrete better-sqlite3 handle. Aliased once so adapters do not each
 * repeat the namespace import, and so the driver is named in a single place.
 */
export type Db = Database.Database;
