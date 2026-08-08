import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Signed download links for Files (pop-agent.spec §14, "Files as a plain folder").
 *
 * Same contract the artifact links had, re-anchored on the path: no file is
 * reachable by a public URL without a signature. The signing key is derived
 * from `secret.key` -- never a fresh standalone secret -- so a rotated key
 * invalidates every outstanding link at once. The signature covers both the
 * path and the expiry, so tampering with either breaks the signature rather
 * than extending the link or renaming its target; verification checks the
 * signature before the expiry for exactly that reason.
 *
 * Expiry is a property of the LINK, not the file: an expired link is rejected
 * even though the file still exists, and a fresh link can be minted at any
 * time. There is no cleanup cron.
 */

const CONTEXT = 'pop.files.download.v1';

/** Default link lifetime: 30 days, configurable by the caller. */
export const DEFAULT_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface SignedLink {
  url: string;
  expiresAt: number;
}

export type LinkCheck = 'ok' | 'malformed' | 'bad-signature' | 'expired';

/** Builds `/files/download?path=<enc>&expires=<ms>&sig=<b64url>`. */
export function buildFileLink(
  secretKey: Buffer,
  relativePath: string,
  now: number,
  ttlMs: number = DEFAULT_LINK_TTL_MS,
): SignedLink {
  const expiresAt = now + ttlMs;
  const sig = sign(secretKey, relativePath, expiresAt);
  return {
    url: `/files/download?path=${encodeURIComponent(relativePath)}&expires=${String(expiresAt)}&sig=${sig}`,
    expiresAt,
  };
}

export function verifyFileDownload(
  secretKey: Buffer,
  relativePath: string,
  expiresRaw: string | undefined,
  sigRaw: string | undefined,
  now: number,
): LinkCheck {
  if (expiresRaw === undefined || sigRaw === undefined) return 'malformed';

  const expiresAt = Number(expiresRaw);
  if (!Number.isInteger(expiresAt)) return 'malformed';

  const expected = Buffer.from(sign(secretKey, relativePath, expiresAt));
  const given = Buffer.from(sigRaw);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return 'bad-signature';
  }

  // Only once the signature is trusted does an untampered expiry mean anything.
  if (now > expiresAt) return 'expired';
  return 'ok';
}

function sign(secretKey: Buffer, relativePath: string, expiresAt: number): string {
  const derived = createHmac('sha256', secretKey).update(CONTEXT).digest();
  return createHmac('sha256', derived)
    .update(`${relativePath}.${String(expiresAt)}`)
    .digest('base64url');
}
