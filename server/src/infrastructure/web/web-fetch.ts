import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * A guarded fetch for the agent's web_fetch tool (pop-agent.spec §12). Only http
 * and https, only public hosts, capped and timed out, and the readable text
 * pulled out of the HTML. SSRF is the real risk: the hostname is resolved and
 * every returned address checked against the private ranges before a
 * connection is made, so the agent cannot be talked into reading the metadata
 * service or something on the LAN.
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
}

export async function webFetch(rawUrl: string, deps: WebFetchDeps = {}): Promise<WebFetchResult> {
  const url = parseUrl(rawUrl);
  await assertPublicHost(url.hostname, deps.resolve ?? defaultResolve);

  const response = await fetch(url, {
    redirect: 'error', // a redirect could point back at a private host
    headers: { 'user-agent': 'PopAgentBot/0.1 (+https://github.com/viniciusbuscacio/pop-agent)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new WebFetchError(error instanceof Error ? error.message : 'The page could not be fetched.');
  });

  if (!response.ok) {
    throw new WebFetchError(`The page answered ${String(response.status)}.`);
  }

  const html = await readCapped(response);
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
  return url;
}

/** Rejects a host whose every resolved address is private, loopback or link-local. */
async function assertPublicHost(
  host: string,
  resolve: (host: string) => Promise<string[]>,
): Promise<void> {
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
}

/** True for loopback, private, link-local and other non-public addresses. */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateV4(address);
  if (version === 6) return isPrivateV6(address);
  return true; // not an IP we understand: refuse rather than guess
}

function isPrivateV4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local (incl. cloud metadata 169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast + reserved
  );
}

function isPrivateV6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback, unspecified
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
  // IPv4-mapped (::ffff:a.b.c.d): check the embedded v4.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1] !== undefined) return isPrivateV4(mapped[1]);
  return false;
}

async function defaultResolve(host: string): Promise<string[]> {
  const records = await lookup(host, { all: true });
  return records.map((record) => record.address);
}

async function readCapped(response: Response): Promise<string> {
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer).subarray(0, MAX_BYTES);
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
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
