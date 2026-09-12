/** Reserve a browsing context during the click, before server preparation awaits. */
export interface PendingTailscaleSignIn {
  navigate(url: string): void;
  close(): void;
}

export function prepareTailscaleSignIn(message: string): PendingTailscaleSignIn {
  let tab: Window | null = null;
  try { tab = window.open('about:blank', '_blank'); } catch { /* Use same-tab navigation if blocked. */ }
  if (tab !== null) {
    tab.opener = null;
    tab.document.title = message;
    tab.document.body.textContent = message;
  }
  return {
    navigate(value) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.hostname !== 'login.tailscale.com'
        || url.username !== '' || url.password !== '' || url.port !== '') {
        throw new Error('Invalid Tailscale sign-in URL');
      }
      if (tab !== null && !tab.closed) tab.location.replace(url.href);
      else window.location.assign(url.href);
    },
    close() { if (tab !== null && !tab.closed) tab.close(); },
  };
}
