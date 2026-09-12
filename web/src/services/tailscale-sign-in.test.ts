import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareTailscaleSignIn } from './tailscale-sign-in';

afterEach(() => vi.unstubAllGlobals());

describe('Tailscale sign-in browser context', () => {
  it('reserves immediately, removes opener access, and navigates the reserved tab', () => {
    const tab = { opener: {}, closed: false, document: { title: '', body: { textContent: '' } }, location: { replace: vi.fn() }, close: vi.fn() };
    const open = vi.fn(() => tab); const assign = vi.fn();
    vi.stubGlobal('window', { open, location: { assign } });
    const pending = prepareTailscaleSignIn('Preparing');
    expect(open).toHaveBeenCalledWith('about:blank', '_blank');
    expect(tab.opener).toBeNull(); expect(tab.document.body.textContent).toBe('Preparing');
    pending.navigate('https://login.tailscale.com/a/test');
    expect(tab.location.replace).toHaveBeenCalledWith('https://login.tailscale.com/a/test');
    expect(assign).not.toHaveBeenCalled();
    pending.close(); expect(tab.close).toHaveBeenCalledOnce();
  });
  it('continues in the current tab when pop-ups are blocked', () => {
    const assign = vi.fn(); vi.stubGlobal('window', { open: () => null, location: { assign } });
    prepareTailscaleSignIn('Preparing').navigate('https://login.tailscale.com/a/test');
    expect(assign).toHaveBeenCalledWith('https://login.tailscale.com/a/test');
  });
  it.each(['javascript:alert(1)', 'http://login.tailscale.com/a/test', 'https://login.tailscale.com.evil.test/', 'https://user@login.tailscale.com/', 'https://login.tailscale.com:444/'])('rejects an unsafe destination: %s', (url) => {
    const assign = vi.fn(); vi.stubGlobal('window', { open: () => null, location: { assign } });
    expect(() => prepareTailscaleSignIn('Preparing').navigate(url)).toThrow();
    expect(assign).not.toHaveBeenCalled();
  });
});
