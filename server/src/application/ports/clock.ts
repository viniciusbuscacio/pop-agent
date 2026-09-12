/**
 * Time as a dependency. Everything that expires, renews or locks out reads the
 * clock through this port, so tests drive those paths by moving a number
 * instead of sleeping.
 */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
}

/** The real clock, for the composition root. */
export const systemClock: Clock = {
  now: () => Date.now(),
};
