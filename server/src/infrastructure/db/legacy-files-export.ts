import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { entityId } from '../../domain/ids.js';
import type { FileProvenanceRepo } from '../../application/ports/file-provenance-repo.js';

/**
 * The one-time walk from the artifact catalog to the plain Files folder
 * (pop-agent.spec §14, spec 1.58 migration note).
 *
 * Reading happens BEFORE the migrations run -- migration 027 drops the very
 * tables this reads -- so bootstrap calls {@link readLegacyCatalog} on the
 * closed database file first, lets the migrations run, and then hands what
 * was read to {@link writeLegacyFiles}. Live rows land under their real
 * folder path and name; trashed rows land in `Garbage/` with their origin
 * noted; earlier versions are not carried over (overwrite is the feature
 * now); provenance is seeded so "which chat made this" survives the move.
 */

export interface LegacyFile {
  /** Relative target path, folders materialised: `Docs/notes.txt`. */
  path: string;
  /** Absolute path of the bytes in the old store. */
  bytesAt: string;
  chatId: string;
  createdAt: string;
  /** Set when the row was in the trash, with its deletion instant. */
  deletedAt?: string;
}

export interface LegacyCatalog {
  files: LegacyFile[];
  artifactsDir: string;
}

/** Reads the old catalog if it is still there; undefined on a migrated or fresh install. */
export function readLegacyCatalog(dbPath: string, artifactsDir: string): LegacyCatalog | undefined {
  if (!existsSync(dbPath)) return undefined;

  const db = new Database(dbPath, { readonly: true });
  try {
    const hasArtifacts = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'artifacts'`)
      .get();
    if (hasArtifacts === undefined) return undefined;

    const folders = db
      .prepare(`SELECT id, name, COALESCE(parent_id, '') AS parent_id FROM folders`)
      .all() as { id: string; name: string; parent_id: string }[];
    const byId = new Map(folders.map((folder) => [folder.id, folder]));
    const pathOf = (folderId: string): string => {
      const segments: string[] = [];
      let current = folderId;
      for (let hops = 0; hops < 64 && current !== ''; hops += 1) {
        const folder = byId.get(current);
        if (folder === undefined) break;
        segments.unshift(folder.name);
        current = folder.parent_id;
      }
      return segments.join('/');
    };

    const rows = db
      .prepare(
        `SELECT id, COALESCE(chat_id, '') AS chat_id, COALESCE(folder_id, '') AS folder_id,
                name, created_at, deleted_at
           FROM artifacts`,
      )
      .all() as {
      id: string;
      chat_id: string;
      folder_id: string;
      name: string;
      created_at: string;
      deleted_at: string | null;
    }[];

    const files = rows.map((row): LegacyFile => {
      const dir = pathOf(row.folder_id);
      return {
        path: dir === '' ? row.name : `${dir}/${row.name}`,
        bytesAt: join(artifactsDir, row.chat_id === '' ? '_files' : row.chat_id, row.id),
        chatId: row.chat_id,
        createdAt: row.created_at,
        ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at }),
      };
    });

    return { files, artifactsDir };
  } finally {
    db.close();
  }
}

/** Writes the catalog into the Files folder and seeds provenance. Returns how many landed. */
export function writeLegacyFiles(
  catalog: LegacyCatalog,
  filesDir: string,
  provenance: FileProvenanceRepo,
  onJournal?: (line: string) => void,
): number {
  const garbageDir = join(filesDir, 'Garbage');
  mkdirSync(garbageDir, { recursive: true, mode: 0o700 });
  let landed = 0;

  const notes: Record<string, { originalPath: string; deletedAt: string }> = readNotes(garbageDir);

  for (const file of catalog.files) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(file.bytesAt);
    } catch {
      // The row outlived its bytes; there is nothing to carry over.
      continue;
    }

    if (file.deletedAt === undefined) {
      const target = freeName(filesDir, file.path);
      mkdirSync(dirname(join(filesDir, target)), { recursive: true, mode: 0o700 });
      writeFileSync(join(filesDir, target), bytes, { mode: 0o600 });
      if (file.chatId !== '') {
        provenance.record({
          id: entityId('prov'),
          chatId: file.chatId,
          path: target,
          createdAt: file.createdAt,
        });
      }
    } else {
      const name = file.path.split('/').at(-1) ?? file.path;
      const entry = freeName(garbageDir, name);
      writeFileSync(join(garbageDir, entry), bytes, { mode: 0o600 });
      notes[entry] = { originalPath: file.path, deletedAt: file.deletedAt };
    }
    landed += 1;
  }

  writeFileSync(join(garbageDir, '.garbage.json'), JSON.stringify(notes, null, 2), {
    mode: 0o600,
  });

  // The old store's job is done; leaving it would double every byte in the
  // next backup for no reader.
  rmSync(catalog.artifactsDir, { recursive: true, force: true });
  onJournal?.(`pop files migration: ${String(landed)} files moved out of the artifact catalog`);
  return landed;
}

/** `name`, then `name (2)`… collisions can only come from same-named files across chats. */
function freeName(root: string, relative: string): string {
  if (!existsSync(join(root, relative))) return relative;
  const dot = relative.lastIndexOf('.');
  const slash = relative.lastIndexOf('/');
  const stem = dot > slash + 1 ? relative.slice(0, dot) : relative;
  const ext = dot > slash + 1 ? relative.slice(dot) : '';
  for (let n = 2; ; n += 1) {
    const candidate = `${stem} (${String(n)})${ext}`;
    if (!existsSync(join(root, candidate))) return candidate;
  }
}

function readNotes(garbageDir: string): Record<string, { originalPath: string; deletedAt: string }> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(garbageDir, '.garbage.json'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, { originalPath: string; deletedAt: string }>)
      : {};
  } catch {
    return {};
  }
}
