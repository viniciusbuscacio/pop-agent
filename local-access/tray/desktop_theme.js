/* global window, document, MutationObserver */
(() => {
  if (window !== window.top) return;
  Object.defineProperty(window, '__popDesktop', { value: true });
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
