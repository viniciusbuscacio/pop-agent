import type { MaintenanceJob } from '../ports/maintenance-job.js';
import type { ArtifactService } from './artifact-service.js';

/**
 * Empties what the trash has kept long enough (popy.spec §14, §21).
 *
 * Housekeeping, not a task: nobody asked for it, there is no chat and no row,
 * and the agent cannot be asked about it. It rides the scheduler's tick like
 * the workspace sweep rather than owning a timer of its own.
 *
 * Daily is the right cadence for a thirty-day window -- checking more often
 * buys nothing, and checking less would let a promise of "thirty days" drift
 * into forty. The window is a floor, not a deadline: a file is never purged
 * early, only at some point after its thirty days.
 *
 * A failed sweep is logged and swallowed. The next tick tries again, and a
 * disk that refuses a delete must not take the scheduler down with it.
 */
export class TrashSweeper implements MaintenanceJob {
  readonly name = 'trash-sweep';
  readonly everyMs = 24 * 60 * 60 * 1000;

  constructor(
    private readonly deps: {
      artifacts: ArtifactService;
      onJournal?: (line: string) => void;
    },
  ) {}

  run(): void {
    try {
      const purged = this.deps.artifacts.purgeExpired();
      // Silence when there was nothing to do: a daily line saying zero is how
      // a log stops being read.
      if (purged > 0) this.deps.onJournal?.(`popy trash sweep: purged=${String(purged)}`);
    } catch (error) {
      this.deps.onJournal?.(
        `popy trash sweep failed: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
