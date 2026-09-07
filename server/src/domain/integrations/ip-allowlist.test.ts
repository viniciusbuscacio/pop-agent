import { expect, it } from 'vitest';
import { allowsIp, validateAllowedIps } from './ip-allowlist.js';
it('matches IPv4, IPv6 and mapped IPv4 addresses without opening unrelated ranges', () => {
  const entries = validateAllowedIps([' 100.64.0.0/10 ', 'fd7a:115c:a1e0::/48', '127.0.0.1']);
  for (const address of ['100.90.175.76', 'fd7a:115c:a1e0::1', '::ffff:100.90.175.76', '127.0.0.1']) expect(allowsIp(entries, address)).toBe(true);
  for (const address of ['100.128.0.1', '192.168.1.1', 'fd7b::1', undefined]) expect(allowsIp(entries, address)).toBe(false);
  expect(allowsIp(['0.0.0.0/0', '::/0'], undefined)).toBe(true);
});
it('validates ranges, deduplicates and refuses empty or malformed policies', () => {
  expect(validateAllowedIps(['127.0.0.1', '127.0.0.1'])).toEqual(['127.0.0.1']);
  for (const entries of [[], ['example.com'], ['1.2.3.4/33'], ['::1/129'], ['1.2.3.4/'], ['::1/-1'], ['1.2.3.4/24/2'], Array(101).fill('::1')]) expect(() => validateAllowedIps(entries)).toThrow();
});
