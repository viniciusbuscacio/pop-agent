/** Navigation requests carrying this marker bypass the PWA app-shell cache. */
export const HARD_REFRESH_PARAM = '_pop_refresh';

export async function hardRefreshPage(): Promise<void> {
  // Keep the current screen if the server cannot deliver a replacement.
  const response = await fetch('/healthz', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('The server could not be reached.');
  const url = new URL(window.location.href);
  url.searchParams.set(HARD_REFRESH_PARAM, crypto.randomUUID());
  window.location.replace(url.href);
}

/** Run before BrowserRouter reads the URL, after the fresh document has loaded. */
export function clearHardRefreshMarker(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(HARD_REFRESH_PARAM)) return;
  url.searchParams.delete(HARD_REFRESH_PARAM);
  window.history.replaceState(window.history.state, '', url.href);
}
