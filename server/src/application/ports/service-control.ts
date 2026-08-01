/**
 * The danger-zone switch for the service Popy runs as (LOTE 6).
 *
 * A port, not a direct `child_process` call, because the blast radius of a
 * wrong implementation is the production service itself: tests and
 * disposable instances wire a fake that only records the call, and only
 * real boots wire the systemd adapter. A `systemctl` string in executable
 * code is how a validation run once restarted the live server.
 */
export interface ServiceControl {
  /** Schedules a restart of the whole service. It comes back on its own. */
  restart(): void;
  /** Schedules a stop. The web dies too; only SSH brings it back. */
  stop(): void;
}
