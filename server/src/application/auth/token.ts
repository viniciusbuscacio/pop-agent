import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Stateless session tokens (popy.spec §9): `base64url(payload).base64url(sig)`
 * over HMAC-SHA256. No JWT library -- the format is fixed, the algorithm is
 * not negotiable, and that is precisely the class of bug JWT libraries keep
 * having.
 *
 * `epoch` is what makes logout-everywhere possible without server-side session
 * storage: bumping it in the database invalidates every token ever issued.
 */

export interface TokenPayload {
  /** Session generation; a token is stale once the stored epoch moves past it. */
  epoch: number;
  /** Issued at, epoch milliseconds. */
  iat: number;
  /** Expires at, epoch milliseconds. */
  exp: number;
}

export type TokenRejection = 'malformed' | 'bad_signature' | 'expired' | 'stale_epoch';

export type VerifyResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; reason: TokenRejection };

export function signToken(payload: TokenPayload, secret: Buffer): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${encoded}.${signature(encoded, secret)}`;
}

export function verifyToken(
  token: string,
  secret: Buffer,
  nowMs: number,
  currentEpoch: number,
): VerifyResult {
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };
  const [encoded, provided] = parts as [string, string];
  if (encoded.length === 0 || provided.length === 0) return { ok: false, reason: 'malformed' };

  // Signature first: nothing inside the payload is trustworthy until it holds.
  if (!signatureMatches(encoded, provided, secret)) return { ok: false, reason: 'bad_signature' };

  const payload = decodePayload(encoded);
  if (payload === undefined) return { ok: false, reason: 'malformed' };
  if (nowMs >= payload.exp) return { ok: false, reason: 'expired' };
  if (payload.epoch !== currentEpoch) return { ok: false, reason: 'stale_epoch' };

  return { ok: true, payload };
}

function signature(encodedPayload: string, secret: Buffer): string {
  return createHmac('sha256', secret).update(encodedPayload, 'utf8').digest('base64url');
}

function signatureMatches(encodedPayload: string, provided: string, secret: Buffer): boolean {
  const expected = Buffer.from(signature(encodedPayload, secret), 'utf8');
  const candidate = Buffer.from(provided, 'utf8');
  // timingSafeEqual throws on length mismatch, and the length of a signature
  // is not a secret, so compare it first.
  if (expected.length !== candidate.length) return false;
  return timingSafeEqual(expected, candidate);
}

function decodePayload(encoded: string): TokenPayload | undefined {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const { epoch, iat, exp } = parsed as Record<string, unknown>;
    if (typeof epoch !== 'number' || typeof iat !== 'number' || typeof exp !== 'number') {
      return undefined;
    }
    return { epoch, iat, exp };
  } catch {
    return undefined;
  }
}
