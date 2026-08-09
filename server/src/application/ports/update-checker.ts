/**
 * Checking whether a newer version is available (pop-agent.spec §15). Pop Agent does not
 * update itself from the running process -- that is a documented shell
 * procedure, run by the maintainer, gated by the same `npm run gate` -- but it
 * can tell the maintainer when there is something to update to.
 */

export interface UpdateStatus {
  pi: { current: string; latest: string | undefined };
  popAgent: { current: string; latest: string | undefined };
  node: string;
  /** Environment tool versions (whisper, ffmpeg, poppler, tesseract). */
  environment: { name: string; version: string }[];
  /** The command that updates Pop Agent, shown in the UI (spec §15). */
  updateCommand: string;
}

export interface UpdateStatusOptions {
  /** Drop cached npm/tag lookups and read installed versions again. */
  refresh?: boolean;
}

export interface UpdateChecker {
  status(options?: UpdateStatusOptions): Promise<UpdateStatus>;
}
