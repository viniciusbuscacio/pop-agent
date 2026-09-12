/**
 * A repeating timer as a dependency (docs/specs/Spec-Pop-General.md §21), for the same reason the
 * clock is one: a test that had to wait thirty real seconds for a tick would
 * be a test nobody runs. The scheduler asks this port to call it back; the
 * unit tests hand it a fake and pull the trigger themselves.
 */
export interface Timer {
  /** Calls `fn` every `ms`. The returned function stops it. */
  every(ms: number, fn: () => void): () => void;
}

/** The real timer, for the composition root. */
export const intervalTimer: Timer = {
  every(ms, fn) {
    const handle = setInterval(fn, ms);
    // A pending tick must not be the reason the process refuses to exit.
    handle.unref?.();
    return () => clearInterval(handle);
  },
};
