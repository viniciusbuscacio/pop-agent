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

let pendingRefresh: Promise<void> | undefined;

/** One manual refresh cycle per page, shared by desktop/mobile controls. */
export function retryHardRefresh(): Promise<void> {
  if (pendingRefresh) return pendingRefresh;
  pendingRefresh = (async () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const started = Date.now();
      try { await hardRefreshPage(); return; }
      catch (error) {
        if (attempt === 9) throw error;
        // Start attempts ten seconds apart, including time spent probing.
        await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, 10_000 - (Date.now() - started))));
      }
    }
  })().finally(() => { pendingRefresh = undefined; });
  return pendingRefresh;
}
