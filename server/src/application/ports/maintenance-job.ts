/**
 * Housekeeping the server does to itself (pop-agent.spec §21). Not a background
 * task: a task is the user's, has a row, a chat and a history, and the agent
 * can be asked about it. These are internal, invisible, and never touch
 * anything the user wrote -- the orphan workspace sweep is the first one.
 *
 * They ride the task scheduler's tick rather than owning a timer each, so
 * there is one place in the process where periodic work happens.
 */
export interface MaintenanceJob {
  /** Stable name; it is what the journal line is keyed on. */
  name: string;
  /** How often it should run, in milliseconds. */
  everyMs: number;
  run(): void | Promise<void>;
}
