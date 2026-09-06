import { describe, expect, it } from 'vitest';
import { secureSetupDestination } from './setup-navigation';

describe('secure setup destination', () => {
  it('builds the password setup path on the verified HTTPS origin', () => {
    expect(secureSetupDestination('https://pop.tail123.ts.net')).toBe('https://pop.tail123.ts.net/setup');
    expect(secureSetupDestination('https://pop.tail123.ts.net/')).toBe('https://pop.tail123.ts.net/setup');
  });
  it.each([undefined, 'http://pop.tail123.ts.net', 'javascript:alert(1)', 'https://pop.tail123.ts.net.evil.test',
    'https://user@pop.tail123.ts.net', 'https://pop.tail123.ts.net:444', 'https://pop.tail123.ts.net/path',
    'https://pop.tail123.ts.net?token=secret', 'https://pop.tail123.ts.net#fragment', 'https://..ts.net'])('refuses an unsafe or malformed origin: %s', (value) => {
    expect(secureSetupDestination(value)).toBeUndefined();
  });
});
