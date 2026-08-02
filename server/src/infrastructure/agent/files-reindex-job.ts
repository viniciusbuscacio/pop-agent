import type { MaintenanceJob } from '../../application/ports/maintenance-job.js';

/**
 * The Files index safety net (popy.spec §14, §21). The index is rebuilt on
 * every Files mutation and once at boot, so in practice it is always current;
 * this daily rebuild exists only to heal drift a crash or a hand-edited
 * database might leave behind. "Theoretically never needed, but there just in
 * case" -- the operator's words.
 *
 * It rides the task scheduler's tick like the orphan sweep, but fires on a
 * wall-clock hour (01:00 local by default, the quiet part of the night) rather
 * than a fixed interval from process start. run() is called on the cadence
 * below and a per-day latch keeps it to one rebuild a day; the latch starts on
 * the boot day, because the boot reindex already covered it -- so the first
 * daily pass is the next 01:00.
 */
export interface FilesReindexJobDeps {
  reindex: () => void;
  now: () => number;
  /** Local hour to fire on (0-23). Default 1 -- 01:00. */
  hour?: number;
  /** How often run() is polled; must divide the hour window. Default 15 min. */
  everyMs?: number;
  onJournal?: (line: string) => void;
}

/** Local `YYYY-MM-DD`, the granularity of the once-a-day latch. */
function localDay(at: number): string {
  const d = new Date(at);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1)}-${String(d.getDate())}`;
}

export class FilesReindexJob implements MaintenanceJob {
  readonly name = 'files-reindex';
  readonly everyMs: number;
  private readonly hour: number;
  private lastDay: string;

  constructor(private readonly deps: FilesReindexJobDeps) {
    this.everyMs = deps.everyMs ?? 15 * 60 * 1000;
    this.hour = deps.hour ?? 1;
    // Latch on the boot day: the boot reindex already made today current, so
    // the first daily rebuild is the next time the target hour comes round.
    this.lastDay = localDay(deps.now());
  }

  run(): void {
    const now = this.deps.now();
    const d = new Date(now);
    if (d.getHours() !== this.hour) return;
    const day = localDay(now);
    if (this.lastDay === day) return;
    this.lastDay = day;
    this.deps.reindex();
    this.deps.onJournal?.('popy files reindex: daily safety net');
  }
}
