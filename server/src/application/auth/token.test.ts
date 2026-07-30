import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signToken, verifyToken, type TokenPayload } from './token.js';

const secret = randomBytes(32);
const NOW = 1_700_000_000_000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

function payload(overrides: Partial<TokenPayload> = {}): TokenPayload {
  return { epoch: 1, iat: NOW, exp: NOW + WEEK, ...overrides };
}

describe('session token', () => {
  it('verifies what it signed', () => {
    const result = verifyToken(signToken(payload(), secret), secret, NOW, 1);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload).toEqual(payload());
  });

  it('rejects a token that is not two parts', () => {
    for (const malformed of ['', 'nodot', 'a.b.c', '.sig', 'payload.']) {
      expect(verifyToken(malformed, secret, NOW, 1)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('rejects an edited payload', () => {
    const token = signToken(payload(), secret);
    const forged = Buffer.from(JSON.stringify(payload({ epoch: 99 })), 'utf8').toString('base64url');
    const tampered = `${forged}.${token.split('.')[1] as string}`;

    expect(verifyToken(tampered, secret, NOW, 1)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects an edited signature', () => {
    const [encoded] = signToken(payload(), secret).split('.') as [string, string];
    const tampered = `${encoded}.${Buffer.from('not-the-signature').toString('base64url')}`;

    expect(verifyToken(tampered, secret, NOW, 1)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a token signed with another secret', () => {
    const token = signToken(payload(), randomBytes(32));

    expect(verifyToken(token, secret, NOW, 1)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('expires exactly at exp', () => {
    const token = signToken(payload(), secret);

    expect(verifyToken(token, secret, NOW + WEEK - 1, 1).ok).toBe(true);
    expect(verifyToken(token, secret, NOW + WEEK, 1)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token from a previous epoch', () => {
    const token = signToken(payload({ epoch: 1 }), secret);

    expect(verifyToken(token, secret, NOW, 2)).toEqual({ ok: false, reason: 'stale_epoch' });
  });

  it('reports a bad signature before looking at the payload', () => {
    // An expired token signed with the wrong secret must not leak that it was
    // expired: the signature check comes first.
    const token = signToken(payload({ exp: NOW - 1 }), randomBytes(32));

    expect(verifyToken(token, secret, NOW, 1)).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
