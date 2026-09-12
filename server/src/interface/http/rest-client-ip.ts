import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import { isIP } from 'node:net';
/** Only the local reverse proxy is trusted; use its last appended hop, never a client-supplied first hop. */
export function resolveRestClientIp(peer: string | undefined, forwarded: string | undefined): string | undefined {
  const address = peer?.replace(/^::ffff:/u, '');
  if (!address || !isIP(address)) return undefined;
  const loopback = address === '::1' || address.startsWith('127.');
  if (!loopback || forwarded === undefined) return address;
  const client = forwarded.split(',').at(-1)?.trim();
  return client && isIP(client) ? client : undefined;
}
export function restClientIp(c: Context): string | undefined {
  try { return resolveRestClientIp(getConnInfo(c).remote.address, c.req.header('x-forwarded-for')); }
  catch { return undefined; }
}
export function isRestApiOperation(path: string, method: string): boolean {
  if (path.startsWith('/v1/integration/')) return true;
  if (path === '/v1/ax') return true;
  if (path === '/v1/ui/sessions') return method === 'GET';
  return /^\/v1\/ui\/(state|screenshot|press|dblclick|key|input)$/u.test(path);
}
