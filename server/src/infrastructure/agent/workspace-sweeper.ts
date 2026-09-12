import { readdirSync, rmSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import type { MaintenanceJob } from '../../application/ports/maintenance-job.js';

/**
 * The orphan sweep (docs/specs/Spec-Pop-General.md §21): once a day, remove the derived files in
 * the workspace that nothing points at any more.
 *
 * Two targets, both deliberately narrow:
 *
 *   - `attachments/<chatId>/` whose chat is no longer in the database. A chat
 *     deleted through the API already takes its folder with it (§6); this
 *     catches the ones a crash, a restore or a hand-edited database left
 *     behind.
 *   - scratch files sitting **directly** in the workspace root, older than
 *     thirty days, and only with an extension the agent is known to leave
 *     behind while working: `.png`, `.yaml`, `.mjs`.
 *
 * Everything else is untouchable, and the list of what this must never do is
 * longer than what it does: never the attachments of a living chat, never the
 * database, never a directory in the workspace root (that is someone's
 * project), never a path outside `POP_AGENT_WORKSPACE`, never a symlink. Session
 * history is forever -- a sweep only ever removes files derived from it.
 *
 * Deletion failures are swallowed by design: a file already gone is the goal.
 */

const SCRATCH_EXTENSIONS: ReadonlySet<string> = new Set(['.png', '.yaml', '.mjs']);
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const DAILY_MS = 24 * 60 * 60 * 1000;

export interface WorkspaceSweeperDeps {
  workspace: string;
  /** The chats that still exist; anything else under attachments/ is an orphan. */
  liveChatIds: () => ReadonlySet<string>;
  now: () => number;
  /** One line per sweep, with the counts. */
  onJournal?: (line: string) => void;
  /** Overridable so the test does not have to fake a month. */
  scratchMaxAgeMs?: number;
}

export interface SweepResult {
  attachments: number;
  scratch: number;
}

export class WorkspaceSweeper implements MaintenanceJob {
  readonly name = 'workspace-sweep';
  readonly everyMs = DAILY_MS;

  constructor(private readonly deps: WorkspaceSweeperDeps) {}

  run(): void {
    const result = this.sweep();
    this.deps.onJournal?.(
      `pop sweep: orphan attachment folders=${String(result.attachments)} ` +
        `scratch files=${String(result.scratch)}`,
    );
  }

  /** Exported behaviour for the test: the counts, without the journal line. */
  sweep(): SweepResult {
    return {
      attachments: this.sweepAttachments(),
      scratch: this.sweepScratch(),
    };
  }

  private sweepAttachments(): number {
    const root = join(this.deps.workspace, 'attachments');
    const live = this.deps.liveChatIds();
    let removed = 0;

    for (const entry of entries(root)) {
      // isDirectory() is false for a symlink, which is exactly the answer we
      // want: a link is not ours to follow, let alone delete recursively.
      if (!entry.isDirectory() || live.has(entry.name)) continue;
      if (remove(join(root, entry.name))) removed += 1;
    }
    return removed;
  }

  private sweepScratch(): number {
    const cutoff = this.deps.now() - (this.deps.scratchMaxAgeMs ?? THIRTY_DAYS_MS);
    let removed = 0;

    for (const entry of entries(this.deps.workspace)) {
      if (!entry.isFile()) continue;
      if (!SCRATCH_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;

      const path = join(this.deps.workspace, entry.name);
      const modified = modifiedAt(path);
      if (modified === undefined || modified > cutoff) continue;
      if (remove(path)) removed += 1;
    }
    return removed;
  }
}

function entries(dir: string): { name: string; isDirectory: () => boolean; isFile: () => boolean }[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    // No attachments yet, or no workspace: nothing to sweep is a fine answer.
    return [];
  }
}

function modifiedAt(path: string): number | undefined {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return undefined;
  }
}

function remove(path: string): boolean {
  try {
    rmSync(path, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
