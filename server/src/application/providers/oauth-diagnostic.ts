/**
 * A log-safe classification, deliberately not a cleaned copy of provider text.
 * Arbitrary bodies may hold HTML, base64, account data or credentials; logs
 * retain only an HTTP status or a small known class.
 */
export function oauthFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const status = message.match(/(?:^|\b)([45]\d{2})(?:\b|$)/)?.[1];
  if (status !== undefined) return `http_${status}`;
  if (/abort|cancel/i.test(message)) return 'aborted';
  if (/time(?:d)? out|too long/i.test(message)) return 'timeout';
  return 'provider_failure';
}
