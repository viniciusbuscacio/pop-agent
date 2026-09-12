/* global window, document, MutationObserver */
(() => {
  if (window !== window.top) return;
  Object.defineProperty(window, '__popDesktop', { value: true });
  if (window.webkit?.messageHandlers?.popUpdate) {
    let pending;
    Object.defineProperty(window, '__popDesktopUpdate', { value: () => {
      if (pending) return pending;
      pending = new Promise((resolve, reject) => {
        const onStatus = event => {
          if (!['current', 'restarting', 'error'].includes(event.detail)) return;
          window.removeEventListener('pop-desktop-update', onStatus);
          if (event.detail === 'error') reject(new Error('Desktop update failed. Please retry.'));
          else resolve(event.detail);
        };
        window.addEventListener('pop-desktop-update', onStatus);
        window.webkit.messageHandlers.popUpdate.postMessage('update');
      }).finally(() => { pending = undefined; });
      return pending;
    } });
  }
  let observing = false;
  let previous;
  const observe = () => {
    if (observing || !document.documentElement) return;
    observing = true;
    const report = () => {
      const theme = document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
      if (theme === previous) return;
      previous = theme;
      const message = `pop-desktop-theme:${theme}`;
      if (window.webkit?.messageHandlers?.popTheme) window.webkit.messageHandlers.popTheme.postMessage(message);
      else window.chrome?.webview?.postMessage(message);
    };
    new MutationObserver(report).observe(document.documentElement, {
      attributes: true, attributeFilter: ['data-theme'],
    });
    report();
  };
  observe();
  document.addEventListener('DOMContentLoaded', observe, { once: true });
})();
