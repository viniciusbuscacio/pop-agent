import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, request } from 'undici';

const MAX_REQUEST_BYTES = 128 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class A2aNetworkError extends Error {
  constructor(
    readonly code:
      | 'invalid_url'
      | 'private_address'
      | 'transport_error'
      | 'response_too_large'
      | 'authentication'
      | 'timeout'
      | 'canceled',
    message: string,
  ) {
    super(message);
    this.name = 'A2aNetworkError';
  }
}

export interface ScreenedFetchOptions {
  timeoutMs: number;
  allowedCredentialOrigin: string;
  credentialHeader?: { name: string; value: string };
  resolve?: (host: string) => Promise<string[]>;
  operationSignal?: () => AbortSignal | undefined;
  retrieve?: (
    request: Request,
    addresses: readonly string[],
    signal: AbortSignal,
  ) => Promise<Response>;
}

/**
 * WHATWG fetch compatible transport for the official A2A SDK. Every request is
 * screened independently and pinned to the addresses that passed policy.
 */
export function createScreenedA2aFetch(options: ScreenedFetchOptions): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = input instanceof Request ? input.url : input.toString();
    const url = parseA2aUrl(rawUrl);
    const outgoing = new Request(input, init);
    const addresses = await publicAddresses(url.hostname, options.resolve ?? defaultResolve);
    const headers = new Headers(outgoing.headers);
    if (url.origin !== options.allowedCredentialOrigin) {
      headers.delete('authorization');
      if (options.credentialHeader !== undefined) headers.delete(options.credentialHeader.name);
    } else if (options.credentialHeader !== undefined) {
      headers.set(options.credentialHeader.name, options.credentialHeader.value);
    } else {
      headers.delete('authorization');
    }
    const body = outgoing.body === null ? undefined : Buffer.from(await outgoing.arrayBuffer());
    if (body !== undefined && body.byteLength > MAX_REQUEST_BYTES) {
      throw new A2aNetworkError('response_too_large', 'The A2A request exceeded the allowed size.');
    }
    const requestWithHeaders = new Request(url, {
      method: outgoing.method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
    const timeout = AbortSignal.timeout(options.timeoutMs);
    const operationSignal = options.operationSignal?.();
    const signal = AbortSignal.any([
      outgoing.signal,
      timeout,
      ...(operationSignal === undefined ? [] : [operationSignal]),
    ]);
    try {
      signal.throwIfAborted();
      return await (options.retrieve ?? pinnedRetrieve)(requestWithHeaders, addresses, signal);
    } catch (error) {
      if (error instanceof A2aNetworkError) throw error;
      if (outgoing.signal.aborted || operationSignal?.aborted === true) {
        throw new A2aNetworkError('canceled', 'The A2A operation was canceled.');
      }
      if (timeout.aborted) {
        throw new A2aNetworkError('timeout', 'The A2A operation timed out.');
      }
      throw new A2aNetworkError(
        'transport_error',
        error instanceof Error ? error.message : 'The A2A endpoint could not be reached.',
      );
    }
  };
}

export async function screenA2aUrl(
  raw: string,
  resolve: (host: string) => Promise<string[]> = defaultResolve,
): Promise<URL> {
  const url = parseA2aUrl(raw);
  await publicAddresses(url.hostname, resolve);
  return url;
}

export function parseA2aUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new A2aNetworkError('invalid_url', 'The A2A URL is invalid.');
  }
  if (url.protocol !== 'https:') {
    throw new A2aNetworkError('invalid_url', 'A2A endpoints must use HTTPS.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new A2aNetworkError('invalid_url', 'A2A URLs must not contain credentials.');
  }
  return url;
}

async function publicAddresses(
  host: string,
  resolve: (host: string) => Promise<string[]>,
): Promise<string[]> {
  const addresses = isIP(host) !== 0 ? [host] : await resolve(host).catch(() => []);
  if (addresses.length === 0) {
    throw new A2aNetworkError('transport_error', 'The A2A host could not be resolved.');
  }
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new A2aNetworkError('private_address', 'The A2A host resolves to a private address.');
    }
  }
  return [...new Set(addresses)];
}

async function pinnedRetrieve(
  outgoing: Request,
  addresses: readonly string[],
  signal: AbortSignal,
): Promise<Response> {
  let cursor = 0;
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, lookupOptions, callback) => {
        const records = addresses.map((address) => ({ address, family: isIP(address) as 4 | 6 }));
        if (typeof lookupOptions === 'object' && lookupOptions.all === true) {
          callback(null, records);
          return;
        }
        const record = records[cursor++ % records.length]!;
        callback(null, record.address, record.family);
      },
    },
  });
  try {
    const body = outgoing.body === null ? undefined : Buffer.from(await outgoing.arrayBuffer());
    const response = await request(outgoing.url, {
      dispatcher,
      method: outgoing.method as 'GET',
      headers: Object.fromEntries(outgoing.headers.entries()),
      ...(body === undefined ? {} : { body }),
      signal,
    });
    if (response.statusCode === 401 || response.statusCode === 403) {
      response.body.destroy();
      throw new A2aNetworkError('authentication', 'The A2A endpoint rejected its credential.');
    }
    const bytes = await readCapped(response.body);
    return new Response(new Uint8Array(bytes), {
      status: response.statusCode,
      headers: Object.fromEntries(
        Object.entries(response.headers).flatMap(([name, value]) =>
          value === undefined ? [] : [[name, Array.isArray(value) ? value.join(', ') : value]]),
      ),
    });
  } finally {
    await dispatcher.close();
  }
}

async function readCapped(body: AsyncIterable<Uint8Array> & { destroy(): void }): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      body.destroy();
      throw new A2aNetworkError('response_too_large', 'The A2A response exceeded the allowed size.');
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

/** Public-routability policy shared by every A2A card and protocol request. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    if (parts.length !== 4 || parts.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
    const [a, b] = parts as [number, number, number, number];
    const c = parts[2] ?? 0;
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0)
      || (a === 192 && b === 0 && c === 2) || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  if (version !== 6 || !/^[23]/.test(address)) return true;
  return BLOCKED_V6.check(address, 'ipv6');
}

const BLOCKED_V6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96],
  ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:2::', 48],
  ['2001:10::', 28], ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7],
  ['fe80::', 10], ['ff00::', 8],
] as const) BLOCKED_V6.addSubnet(network, prefix, 'ipv6');

async function defaultResolve(host: string): Promise<string[]> {
  return (await lookup(host, { all: true })).map((entry) => entry.address);
}
