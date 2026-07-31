import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed download links for artifacts (popy.spec §14, RF-004–008).
 *
 * No artifact is reachable by a public URL without a signature. The signing
 * key is derived from `secret.key` -- never a fresh standalone secret -- so a
 * rotated key invalidates every outstanding link at once. The signature covers
 * both the id and the expiry, so tampering with `expires` breaks the signature
 * rather than extending the link; verification checks the signature before the
 * expiry for exactly that reason.
 *
 * Expiry is a property of the LINK, not the artifact: an expired link is
 * rejected even though the file still exists, and a fresh link can be minted at
 * any time. There is no cleanup cron.
 */

const CONTEXT = 'popy.artifact.download.v1';

/** Default link lifetime: 30 days (RF-007), configurable by the caller. */
export const DEFAULT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SignedLink {
  url: string;
  expiresAt: number;
}

export type LinkCheck = 'ok' | 'malformed' | 'bad-signature' | 'expired';

/** Builds `/artifacts/<id>/download?expires=<ms>&sig=<b64url>`. */
export function buildSignedLink(
  secretKey: Buffer,
  fileId: string,
  now: number,
  ttlMs: number = DEFAULT_LINK_TTL_MS,
): SignedLink {
  const expiresAt = now + ttlMs;
  const sig = sign(secretKey, fileId, expiresAt);
  return { url: `/artifacts/${fileId}/download?expires=${expiresAt}&sig=${sig}`, expiresAt };
}

export function verifyDownload(
  secretKey: Buffer,
  fileId: string,
  expiresRaw: string | undefined,
  sigRaw: string | undefined,
  now: number,
): LinkCheck {
  return check(secretKey, fileId, expiresRaw, sigRaw, now);
}

/** A signed link to one specific archived version (RF-018). */
export function buildVersionLink(
  secretKey: Buffer,
  fileId: string,
  version: number,
  now: number,
  ttlMs: number = DEFAULT_LINK_TTL_MS,
): SignedLink {
  const expiresAt = now + ttlMs;
  const sig = sign(secretKey, `${fileId}.v${String(version)}`, expiresAt);
  return {
    url: `/artifacts/${fileId}/versions/${String(version)}/download?expires=${expiresAt}&sig=${sig}`,
    expiresAt,
  };
}

export function verifyVersionDownload(
  secretKey: Buffer,
  fileId: string,
  version: number,
  expiresRaw: string | undefined,
  sigRaw: string | undefined,
  now: number,
): LinkCheck {
  return check(secretKey, `${fileId}.v${String(version)}`, expiresRaw, sigRaw, now);
}

function check(
  secretKey: Buffer,
  subject: string,
  expiresRaw: string | undefined,
  sigRaw: string | undefined,
  now: number,
): LinkCheck {
  if (expiresRaw === undefined || sigRaw === undefined) return 'malformed';

  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(expiresAt)) return 'malformed';

  const expected = Buffer.from(sign(secretKey, subject, expiresAt));
  const given = Buffer.from(sigRaw);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return 'bad-signature';
  }

  // Only once the signature is trusted does an untampered expiry mean anything.
  if (now > expiresAt) return 'expired';
  return 'ok';
}

function sign(secretKey: Buffer, subject: string, expiresAt: number): string {
  const derived = createHmac('sha256', secretKey).update(CONTEXT).digest();
  return createHmac('sha256', derived).update(`${subject}.${expiresAt}`).digest('base64url');
}
