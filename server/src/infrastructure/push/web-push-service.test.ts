import { describe, expect, it } from 'vitest';
import { vapidSubject } from './web-push-service.js';

/**
 * The VAPID `sub` claim decides whether an iPhone ever rings. Apple validates
 * it and answers 403 `BadJwtToken` for anything it dislikes, and nothing in
 * the UI says so -- the notification simply never arrives. Measured against
 * web.push.apple.com on 01/08/2026: `mailto:pop-agent@localhost` -> 403,
 * `https://github.com/viniciusbuscacio/pop-agent` -> 201.
 */

const DEFAULT = 'https://github.com/viniciusbuscacio/pop-agent';

describe('vapidSubject', () => {
  it('defaults to a real contact URL when nothing is configured', () => {
    expect(vapidSubject()).toBe(DEFAULT);
    expect(vapidSubject('')).toBe(DEFAULT);
    expect(vapidSubject('   ')).toBe(DEFAULT);
  });

  it('keeps an operator address that Apple will accept', () => {
    expect(vapidSubject('mailto:vinicius@example.com')).toBe('mailto:vinicius@example.com');
    expect(vapidSubject('  mailto:ops@pop-agent.example.org  ')).toBe('mailto:ops@pop-agent.example.org');
    expect(vapidSubject('https://pop-agent.example.com/contact')).toBe('https://pop-agent.example.com/contact');
  });

  it('drops what would be rejected upstream rather than honouring it', () => {
    // The trap: a fine address for a machine talking to itself, and not a
    // domain Apple accepts. This exact value was what silently broke push.
    expect(vapidSubject('mailto:pop-agent@localhost')).toBe(DEFAULT);
    expect(vapidSubject('https://localhost:8787')).toBe(DEFAULT);
    expect(vapidSubject('mailto: spaced@example.com')).toBe(DEFAULT);
    expect(vapidSubject('mailto:<ops@example.com>')).toBe(DEFAULT);
    expect(vapidSubject('mailto:no-at-sign.example.com')).toBe(DEFAULT);
    expect(vapidSubject('http://example.com')).toBe(DEFAULT); // not https
    expect(vapidSubject('pop@example.com')).toBe(DEFAULT); // no scheme
    expect(vapidSubject('https://')).toBe(DEFAULT);
  });
});
