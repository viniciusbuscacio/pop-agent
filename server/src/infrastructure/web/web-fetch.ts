import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent, request } from 'undici';

/**
 * Guarded public-web retrieval for the `web_fetch` tool. DNS is resolved and
 * screened once, then the HTTP client is pinned to those exact public
 * addresses. That closes the DNS-rebinding gap between policy check and TCP
 * connection. Redirects are refused because each destination needs a fresh
 * policy decision.
 */

const TIMEOUT_MS = 20_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 20_000;

export class WebFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebFetchError';
  }
}

export interface WebFetchResult {
  url: string;
  title: string | undefined;
  text: string;
}

export interface WebFetchDeps {
  /** Resolves a hostname to its addresses; injectable so tests need no DNS. */
  resolve?: (host: string) => Promise<string[]>;
  /** Test seam after address validation; production always uses pinnedRequest. */
  retrieve?: (url: URL, addresses: readonly string[]) => Promise<string>;
}

export async function webFetch(rawUrl: string, deps: WebFetchDeps = {}): Promise<WebFetchResult> {
  const url = parseUrl(rawUrl);
  const addresses = await publicAddresses(url.hostname, deps.resolve ?? defaultResolve);
  const retrieve = deps.retrieve ?? pinnedRequest;
  const html = await retrieve(url, addresses).catch((error: unknown) => {
    if (error instanceof WebFetchError) throw error;
    throw new WebFetchError(error instanceof Error ? error.message : 'The page could not be fetched.');
  });
  return { url: url.toString(), title: extractTitle(html), text: extractText(html) };
}

function parseUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new WebFetchError('That is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebFetchError('Only http and https URLs can be fetched.');
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebFetchError('URLs containing credentials cannot be fetched.');
  }
  return url;
}

async function publicAddresses(
  host: string,
  resolve: (host: string) => Promise<string[]>,
): Promise<string[]> {
  const literal = isIP(host);
  const addresses = literal ? [host] : await resolve(host).catch(() => []);
  if (addresses.length === 0) {
    throw new WebFetchError('That host could not be resolved.');
  }
  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      throw new WebFetchError('That host resolves to a private address and cannot be fetched.');
    }
  }
  return [...new Set(addresses)];
}

async function pinnedRequest(url: URL, addresses: readonly string[]): Promise<string> {
  let cursor = 0;
  const dispatcher = new Agent({
    connect: {
      lookup: (_hostname, options, callback) => {
        const records = addresses.map((address) => ({ address, family: isIP(address) as 4 | 6 }));
        if (typeof options === 'object' && options.all === true) {
          callback(null, records);
          return;
        }
        const record = records[cursor++ % records.length]!;
        callback(null, record.address, record.family);
      },
    },
  });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await request(url, {
      dispatcher,
      headers: { 'user-agent': 'PopAgentBot/0.1 (+https://github.com/viniciusbuscacio/pop-agent)' },
      signal: controller.signal,
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      response.body.destroy();
      throw new WebFetchError(`The page answered ${String(response.statusCode)}.`);
    }
    return await readCapped(response.body);
  } finally {
    clearTimeout(timeout);
    await dispatcher.close();
  }
}

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version === 6) return isPrivateV6(address);
  return true;
}

function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

const BLOCKED_V6 = new BlockList();
for (const [network, prefix] of [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['::ffff:0:0', 96], // IPv4-mapped; DNS should return the original IPv4 instead
  ['64:ff9b::', 96], // NAT64 can encode a private IPv4 destination
  ['64:ff9b:1::', 48],
  ['100::', 64], // discard-only
  ['2001::', 32], // Teredo and other transition space
  ['2001:2::', 48], // benchmarking
  ['2001:10::', 28], // ORCHID
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4 can encode a private IPv4 destination
  ['fc00::', 7], // unique-local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  BLOCKED_V6.addSubnet(network, prefix, 'ipv6');
}

function isPrivateV6(address: string): boolean {
  // Public routable IPv6 currently lives in 2000::/3. Refuse future/special
  // spaces until their security semantics are explicitly classified.
  if (!/^[23]/.test(address)) return true;
  return BLOCKED_V6.check(address, 'ipv6');
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
}

async function readCapped(body: AsyncIterable<Uint8Array> & { destroy(): void }): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    const buffer = Buffer.from(chunk);
    const remaining = MAX_BYTES - bytes;
    if (buffer.byteLength > remaining) {
      if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
      body.destroy();
      break;
    }
    chunks.push(buffer);
    bytes += buffer.byteLength;
    if (bytes === MAX_BYTES) {
      body.destroy();
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}

function extractTitle(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title !== undefined && title.length > 0 ? title.slice(0, 200) : undefined;
}

/** Readable text: drop scripts and styles, strip tags, collapse whitespace. */
export function extractText(html: string): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…[truncated]` : text;
}
