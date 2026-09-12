// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
const script = readFileSync('local-access/tray/desktop_theme.js', 'utf8');
afterEach(() => { Reflect.deleteProperty(window, 'webkit'); Reflect.deleteProperty(window, 'chrome'); });
it.each(['webkit', 'chrome'])('reports resolved themes through the %s appearance channel', async (platform) => {
 const postMessage = vi.fn();
 Object.defineProperty(window, platform, { configurable: true, value: platform === 'webkit' ? { messageHandlers: { popTheme: { postMessage } } } : { webview: { postMessage } } });
 document.documentElement.dataset['theme'] = 'dark';
 window.eval(script);
 expect(Reflect.get(window, '__popDesktop')).toBe(true);
 expect(postMessage).toHaveBeenCalledWith('pop-desktop-theme:dark');
 document.documentElement.dataset['theme'] = 'light';
 await vi.waitFor(() => expect(postMessage).toHaveBeenLastCalledWith('pop-desktop-theme:light'));
});
it('shares a native update request and allows retry after failure', async () => {
 const postMessage = vi.fn();
 Object.defineProperty(window, 'webkit', { configurable: true, value: { messageHandlers: { popUpdate: { postMessage } } } });
 window.eval(script);
 const update = Reflect.get(window, '__popDesktopUpdate') as () => Promise<string>;
 const first = update();
 expect(update()).toBe(first);
 expect(postMessage).toHaveBeenCalledExactlyOnceWith('update');
 window.dispatchEvent(new CustomEvent('pop-desktop-update', { detail: 'downloading' }));
 window.dispatchEvent(new CustomEvent('pop-desktop-update', { detail: 'current' }));
 await expect(first).resolves.toBe('current');
 const second = update();
 const rejection = expect(second).rejects.toThrow('Desktop update failed');
 window.dispatchEvent(new CustomEvent('pop-desktop-update', { detail: 'error' }));
 await rejection;
 const retry = update();
 window.dispatchEvent(new CustomEvent('pop-desktop-update', { detail: 'restarting' }));
 await expect(retry).resolves.toBe('restarting');
 expect(postMessage).toHaveBeenCalledTimes(3);
});
