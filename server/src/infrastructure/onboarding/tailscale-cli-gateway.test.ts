import { describe, expect, it } from 'vitest';
import { classifyServe, consentUrlFrom } from './tailscale-cli-gateway.js';

describe('Tailscale Serve inspection', () => {
  it('accepts only one private HTTPS proxy to the exact Pop loopback origin', () => {
    const ours = JSON.stringify({
      TCP: { '443': { HTTPS: true } },
      Web: {
        'pop.example.ts.net:443': {
          Handlers: { '/': { Proxy: 'http://127.0.0.1:8787' } },
        },
      },
    });
    expect(classifyServe('{}', 8787)).toBe('none');
    expect(classifyServe(ours, 8787)).toBe('ours');
    expect(classifyServe(ours, 9999)).toBe('conflict');
    expect(classifyServe('{"TCP":{"443":{"HTTPS":false}}}', 8787)).toBe('conflict');
    expect(classifyServe('not json', 8787)).toBe('conflict');
  });

  it('returns only a strict Tailscale consent URL from command output', () => {
    expect(consentUrlFrom('Enable Serve: https://login.tailscale.com/admin/feature/serve?node=abc')).toBe(
      'https://login.tailscale.com/admin/feature/serve?node=abc',
    );
    expect(consentUrlFrom('https://evil.example/admin/feature/serve')).toBeUndefined();
    expect(consentUrlFrom('https://login.tailscale.com.evil.example/admin/feature/serve')).toBeUndefined();
  });
});
