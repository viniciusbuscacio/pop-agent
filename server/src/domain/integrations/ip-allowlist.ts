import { BlockList, isIP } from 'node:net';
import { IntegrationError } from './integration.js';
export const DEFAULT_ALLOWED_IPS = ['127.0.0.1/32'];
function parts(value: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } {
  const [address = '', mask, extra] = value.split('/');
  const version = isIP(address);
  const maximum = version === 4 ? 32 : 128;
  if (!version || extra !== undefined || (mask !== undefined && !/^\d{1,3}$/u.test(mask))) throw new IntegrationError(400, 'invalid_ip_address');
  const prefix = mask === undefined ? maximum : Number(mask);
  if (prefix > maximum) throw new IntegrationError(400, 'invalid_ip_address');
  return { address, prefix, family: version === 4 ? 'ipv4' : 'ipv6' };
}
export function validateAllowedIps(entries: string[]): string[] {
  if (entries.length < 1 || entries.length > 100) throw new IntegrationError(400, 'invalid_ip_list');
  return [...new Set(entries.map(entry => { const value = entry.trim().toLowerCase(); parts(value); return value; }))];
}
export function allowsIp(entries: string[], address: string | undefined): boolean {
  // An explicit all-addresses policy has no source restriction, including adapters without socket info.
  if (entries.includes('0.0.0.0/0') && entries.includes('::/0')) return true;
  if (!address || !isIP(address)) return false;
  const allowed = new BlockList();
  for (const entry of entries) { const rule = parts(entry); allowed.addSubnet(rule.address, rule.prefix, rule.family); }
  return allowed.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
}
