import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { NoteJail } from './note-jail.js';

/**
 * The agent's own notes vault (pop-agent.spec §11): plain markdown under
 * `POP_AGENT_DATA_DIR/notes/`, Obsidian-compatible by being nothing but `.md`
 * files. Every path goes through the {@link NoteJail}, so a tool can never
 * read or write outside the vault. Reads are capped; content the tools return
 * is the caller's to sanitize (a note can hold text copied from anywhere).
 */

const MAX_READ_BYTES = 64 * 1024;
const MAX_SEARCH_HITS = 20;
const MAX_LIST = 500;

export interface NoteHit {
  path: string;
  line: number;
  text: string;
}

export class NotesVault {
  private readonly jail: NoteJail;

  constructor(root: string) {
    mkdirSync(root, { recursive: true });
    this.jail = new NoteJail(root);
  }

  get root(): string {
    return this.jail.rootPath;
  }

  /** Every note in the vault, as vault-relative paths, newest activity aside. */
  list(): string[] {
    const out: string[] = [];
    this.walk(this.jail.rootPath, out);
    return out.slice(0, MAX_LIST).sort();
  }

  count(): number {
    const out: string[] = [];
    this.walk(this.jail.rootPath, out);
    return out.length;
  }

  /** A note's text, capped. Throws through the jail for a bad path. */
  read(path: string): string {
    const absolute = this.jail.resolve(path);
    const raw = readFileSync(absolute, 'utf8');
    return raw.length > MAX_READ_BYTES ? `${raw.slice(0, MAX_READ_BYTES)}\n…[truncated]` : raw;
  }

  /** Writes (creating folders as needed) and returns the vault-relative path. */
  write(path: string, content: string): string {
    const absolute = this.jail.resolve(path);
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content);
    return relative(this.jail.rootPath, absolute).split('\\').join('/');
  }

  /**
   * Adds to the end of a note, creating it when it is not there yet, and
   * returns the vault-relative path.
   *
   * Its own operation rather than a read-then-{@link write}, because
   * {@link read} is capped: a note past the cap would come back truncated and
   * writing that copy back would delete the rest of it. Appending straight to
   * the file cannot lose what it never read.
   */
  append(path: string, content: string): string {
    const absolute = this.jail.resolve(path);
    mkdirSync(dirname(absolute), { recursive: true });
    // The new text always starts its own line: a heading glued onto the end of
    // the previous paragraph is a different document.
    const size = existsSync(absolute) ? statSync(absolute).size : 0;
    const separator = size > 0 && !endsWithNewline(absolute, size) ? '\n' : '';
    appendFileSync(absolute, `${separator}${content}`);
    return relative(this.jail.rootPath, absolute).split('\\').join('/');
  }

  /** A plain substring search across the vault, case-insensitive, capped. */
  search(query: string): NoteHit[] {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) return [];

    const hits: NoteHit[] = [];
    for (const path of this.list()) {
      if (hits.length >= MAX_SEARCH_HITS) break;
      let content: string;
      try {
        content = this.read(path);
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (line.toLowerCase().includes(needle)) {
          hits.push({ path, line: index + 1, text: line.trim().slice(0, 200) });
          if (hits.length >= MAX_SEARCH_HITS) break;
        }
      }
    }
    return hits;
  }

  private walk(dir: string, out: string[]): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) this.walk(full, out);
      else if (entry.endsWith('.md')) {
        out.push(relative(this.jail.rootPath, full).split('\\').join('/'));
      }
    }
  }
}

/** Reads the one byte that decides it, so appending never loads a whole note. */
function endsWithNewline(absolute: string, size: number): boolean {
  const fd = openSync(absolute, 'r');
  try {
    const tail = Buffer.alloc(1);
    readSync(fd, tail, 0, 1, size - 1);
    return tail[0] === 0x0a;
  } finally {
    closeSync(fd);
  }
}
