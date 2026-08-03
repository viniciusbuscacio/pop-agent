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
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.download = '';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
