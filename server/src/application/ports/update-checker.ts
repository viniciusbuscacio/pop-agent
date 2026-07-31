/**
 * Checking whether a newer version is available (popy.spec §15). Popy does not
 * update itself from the running process -- that is a documented shell
 * procedure, run by the maintainer, gated by the same `npm run gate` -- but it
 * can tell the maintainer when there is something to update to.
 */

export interface UpdateStatus {
  pi: { current: string; latest: string | undefined };
  popy: { current: string; latest: string | undefined };
  node: string;
  /** Environment tool versions (whisper, ffmpeg, poppler, tesseract). */
  environment: { name: string; version: string }[];
  /** The command that updates Popy, shown in the UI (spec §15). */
  updateCommand: string;
}

export interface UpdateChecker {
  status(): Promise<UpdateStatus>;
}
