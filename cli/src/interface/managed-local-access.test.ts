import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createManagedInput } from './managed-local-access.js';

describe('managed local access control pipe', () => {
  it('keeps stdin open and applies renewed sessions in memory', async () => {
    const source = new PassThrough();
    const input = createManagedInput(source);
    source.write(`${JSON.stringify({
      kind: 'start', protocol: 1, url: 'https://pop.example', token: 'token-one', role: 'managed-default',
    })}\n`);

    await expect(input.initial).resolves.toMatchObject({ token: 'token-one' });
    expect(input.token()).toBe('token-one');

    source.write(`${JSON.stringify({ kind: 'session', token: 'token-two' })}\n`);
    await new Promise((resolve) => setImmediate(resolve));
    expect(input.token()).toBe('token-two');

    source.end();
    await expect(input.closed).resolves.toBeUndefined();
  });

  it('rejects an invalid initial control message', async () => {
    const source = new PassThrough();
    const input = createManagedInput(source);
    source.end('{"kind":"session","token":"too-early"}\n');

    await expect(input.initial).resolves.toBeUndefined();
    await expect(input.closed).resolves.toBeUndefined();
  });
});
