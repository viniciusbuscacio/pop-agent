/**
 * Whether a failed attempt deserves another provider (pop-agent.spec §15, fase 2).
 *
 * The verdict is typed -- a code the bridge assigned, plus the HTTP status
 * where one was available -- never a substring match over prose. The classes:
 *
 * - **Fail forward**: auth and quota refusals (401/402/403), a missing route
 *   or model (404), the provider timing out or shedding load (408/429), any
 *   5xx, transport failures (`network_error`), and a provider that turned out
 *   not to be configured after all. A different provider can genuinely answer
 *   these.
 * - **Never**: a 400 (the request itself is wrong -- it will be wrong
 *   everywhere), the user's own Stop (`aborted`), and a turn the taint guard
 *   flagged (`turn_tainted` -- retrying elsewhere would re-run the risk).
 * - **Everything else** -- an error with no status, an internal bug -- stays
 *   where it is: retrying an unknown failure on someone else's bill is a
 *   guess, and a persistent context overflow (which the bridge already
 *   compacted and retried once, same provider) lands here too.
 */

export interface RunFailure {
  code: string;
  /** HTTP status of the provider's refusal, when the bridge could tell. */
  status?: number;
}

const FAILOVER_STATUSES = new Set([401, 402, 403, 404, 408, 429]);

/** Codes that fail over regardless of status. */
const FAILOVER_CODES = new Set([
  'network_error',
  'provider_not_configured',
  // An endpoint that accepted the connection and then said nothing. Distinct
  // from `aborted` on purpose: the user stopping must not fail over, but a
  // provider that never answers must, or one unreachable endpoint freezes
  // every chat that starts there.
  'attempt_timeout',
]);

/** Codes that never fail over, whatever the status says. */
const FATAL_CODES = new Set(['aborted', 'turn_tainted']);

export function shouldFailOver(failure: RunFailure): boolean {
  if (FATAL_CODES.has(failure.code)) return false;
  if (FAILOVER_CODES.has(failure.code)) return true;
  const status = failure.status;
  if (status === undefined) return false;
  return FAILOVER_STATUSES.has(status) || (status >= 500 && status <= 599);
}
