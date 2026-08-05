import { artifactsService } from '../services/artifacts';

/**
 * Downloads a signed link by clicking an invisible anchor. The link arrives
 * after an await, so window.open would be popup-blocked -- the click's user
 * activation is spent by the time the URL exists (which is why Download did
 * nothing, on desktop and phone alike). The server sends
 * `Content-Disposition: attachment`, so navigating an anchor saves the file
 * without leaving the app.
 */
/**
 * Opens a signed link in a new tab, for a file the server agreed to display.
 *
 * The tab has to be opened on the click itself, before the await: by the time
 * the signed URL exists the click's user activation is spent and window.open
 * is a popup blocked in silence -- the same trap that made Download do nothing
 * (see below). So an empty tab is claimed first and pointed at the file when
 * the link arrives.
 *
 * If the popup blocker wins anyway, saving beats appearing to do nothing.
 */
export function viewFromLink(pending: Promise<string>): void {
  const tab = window.open('about:blank', '_blank');
  void pending.then(
    (url) => {
      if (tab === null || tab.closed) {
        saveFromLink(url);
        return;
      }
      // Nothing on the other side needs a handle back to the app.
      tab.opener = null;
      tab.location.replace(url);
    },
    () => tab?.close(),
  );
}

export function saveFromLink(url: string): void {
  // A standalone iOS PWA ignores `download` on an ordinary URL and navigates
  // its own webview instead -- which is why Download opened the file in the
  // app and trapped it there, with no way back but killing the app. Fetching
  // the bytes first turns it into a blob: URL, which the same webview does
  // save (Popy, 05/08).
  void artifactsService.blob(url).then(
    ({ blob, filename }) => {
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.rel = 'noopener';
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      // Revoked late: Safari has been known to read the blob after the click
      // returns, and a URL revoked too early saves an empty file.
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    },
    () => {
      // Whatever went wrong, navigating the signed link still reaches the
      // file. Worse on iOS, but better than a button that does nothing.
      window.location.assign(url);
    },
  );
}
