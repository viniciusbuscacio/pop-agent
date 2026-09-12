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
