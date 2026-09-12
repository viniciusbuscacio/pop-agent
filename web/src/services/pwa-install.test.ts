// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
});

function installEvent(outcome: 'accepted' | 'dismissed') {
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt,
    userChoice: Promise.resolve({ outcome }),
  });
  return { event, prompt };
}

describe('PWA installation prompt', () => {
  it('captures the browser event early and opens it only after the button action', async () => {
    const service = await import('./pwa-install');
    const offered = installEvent('accepted');

    window.dispatchEvent(offered.event);
    expect(service.pwaInstallStatus()).toBe('available');
    expect(offered.event.defaultPrevented).toBe(true);

    await expect(service.installPwa()).resolves.toBe('accepted');
    expect(offered.prompt).toHaveBeenCalledOnce();
    expect(service.pwaInstallStatus()).toBe('installed');
  });

  it('reports an unavailable prompt instead of pretending the page can force installation', async () => {
    const service = await import('./pwa-install');

    expect(service.pwaInstallStatus()).toBe('unavailable');
    await expect(service.installPwa()).resolves.toBe('unavailable');
  });
});
