import { describe, expect, it, vi } from 'vitest';
import { A2aNetworkError, createScreenedA2aFetch, isPrivateAddress, screenedHttpResponse } from './screened-fetch.js';

const publicDns = async (): Promise<string[]> => ['8.8.8.8'];

describe('screened A2A fetch', () => {
  it.each([
    '127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1',
    '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '2001:db8::1',
  ])('classifies %s as private or reserved', (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it('requires credential-free HTTPS and rejects private DNS before retrieval', async () => {
    const retrieve = vi.fn();
    const fetchImpl = createScreenedA2aFetch({
      timeoutMs: 1_000,
      allowedCredentialOrigin: 'https://agent.example',
      resolve: async () => ['127.0.0.1'],
      retrieve,
    });

    await expect(fetchImpl('http://agent.example')).rejects.toMatchObject({ code: 'invalid_url' });
    await expect(fetchImpl('https://user:pass@agent.example')).rejects.toMatchObject({ code: 'invalid_url' });
    await expect(fetchImpl('https://agent.example')).rejects.toMatchObject({ code: 'private_address' });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('pins screened addresses and sends credentials only to the configured origin', async () => {
    const seen: Array<{ url: string; authorization: string | null; addresses: readonly string[] }> = [];
    const fetchImpl = createScreenedA2aFetch({
      timeoutMs: 1_000,
      allowedCredentialOrigin: 'https://agent.example',
      credentialHeader: { name: 'Authorization', value: 'Bearer secret-value' },
      resolve: publicDns,
      retrieve: async (request, addresses) => {
        seen.push({ url: request.url, authorization: request.headers.get('authorization'), addresses });
        return new Response('{}', { status: 200 });
      },
    });

    await fetchImpl('https://agent.example/a2a');
    await fetchImpl('https://other.example/a2a', {
      headers: { Authorization: 'Bearer must-not-cross-origins' },
    });

    expect(seen).toEqual([
      { url: 'https://agent.example/a2a', authorization: 'Bearer secret-value', addresses: ['8.8.8.8'] },
      { url: 'https://other.example/a2a', authorization: null, addresses: ['8.8.8.8'] },
    ]);
  });

  it('acquires dynamic credentials only after screening and only for the exact origin', async () => {
    const provider = vi.fn(async () => ({ name: 'Authorization', value: 'Bearer dynamic-token' }));
    const seen: Array<string | null> = [];
    const fetchImpl = createScreenedA2aFetch({
      timeoutMs: 1_000,
      allowedCredentialOrigin: 'https://agent.example',
      credentialHeaderProvider: provider,
      resolve: publicDns,
      retrieve: async (request) => {
        seen.push(request.headers.get('authorization'));
        return new Response('{}', { status: 200 });
      },
    });

    await fetchImpl('https://other.example/a2a');
    expect(provider).not.toHaveBeenCalled();
    await fetchImpl('https://agent.example/a2a');
    expect(provider).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([null, 'Bearer dynamic-token']);

    const blockedProvider = vi.fn(async () => ({ name: 'Authorization', value: 'Bearer secret' }));
    const blocked = createScreenedA2aFetch({
      timeoutMs: 1_000,
      allowedCredentialOrigin: 'https://agent.example',
      credentialHeaderProvider: blockedProvider,
      resolve: async () => ['127.0.0.1'],
    });
    await expect(blocked('https://agent.example/a2a')).rejects.toMatchObject({ code: 'private_address' });
    expect(blockedProvider).not.toHaveBeenCalled();
  });

  it('propagates caller cancellation and a bounded timeout', async () => {
    const retrieve = async (_request: Request, _addresses: readonly string[], signal: AbortSignal): Promise<Response> =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    const controller = new AbortController();
    const canceledFetch = createScreenedA2aFetch({
      timeoutMs: 1_000,
      allowedCredentialOrigin: 'https://agent.example',
      resolve: publicDns,
      retrieve,
    });
    const canceled = canceledFetch('https://agent.example', { signal: controller.signal });
    controller.abort();
    await expect(canceled).rejects.toMatchObject({ code: 'canceled' });

    const timedFetch = createScreenedA2aFetch({
      timeoutMs: 5,
      allowedCredentialOrigin: 'https://agent.example',
      resolve: publicDns,
      retrieve,
    });
    await expect(timedFetch('https://agent.example')).rejects.toMatchObject({ code: 'timeout' });
  });

  it('preserves bounded transport failures without exposing a response body', async () => {
    const fetchImpl = createScreenedA2aFetch({
      timeoutMs: 1_000,
      allowedCredentialOrigin: 'https://agent.example',
      resolve: publicDns,
      retrieve: async () => { throw new A2aNetworkError('response_too_large', 'too large'); },
    });
    await expect(fetchImpl('https://agent.example')).rejects.toMatchObject({ code: 'response_too_large' });
  });
});


it.each([204,205,304])('preserves bodyless HTTP status %s for REST operations', async status => {
  const response=screenedHttpResponse(new Uint8Array(),{status,headers:{'x-result':'ok'}});
  expect(response.status).toBe(status);expect(response.headers.get('x-result')).toBe('ok');expect(await response.text()).toBe('');
});

it('allows only explicitly approved private destinations on the configured origin', async () => {
  const retrieve = vi.fn(async () => new Response('{}'));
  const call = createScreenedA2aFetch({
    timeoutMs: 1000, allowedCredentialOrigin: 'https://peer.example',
    allowedPrivateIps: ['100.70.1.2/32'], resolve: async () => ['100.70.1.2'], retrieve,
  });
  await call('https://peer.example/a2a/rpc');
  expect(retrieve).toHaveBeenCalledOnce();
  await expect(call('https://other.example/a2a/rpc')).rejects.toMatchObject({ code: 'private_address' });
});
it.each(['127.0.0.1', '169.254.169.254', '0.0.0.0', '224.0.0.1'])('never allows reserved destination %s through a broad CIDR', async address => {
  const retrieve = vi.fn();
  const call = createScreenedA2aFetch({
    timeoutMs: 1000, allowedCredentialOrigin: 'https://peer.example',
    allowedPrivateIps: ['0.0.0.0/0'], resolve: async () => [address], retrieve,
  });
  await expect(call('https://peer.example')).rejects.toMatchObject({ code: 'private_address' });
  expect(retrieve).not.toHaveBeenCalled();
});
