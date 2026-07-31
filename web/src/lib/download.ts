/**
 * Downloads a signed link by clicking an invisible anchor. The link arrives
 * after an await, so window.open would be popup-blocked -- the click's user
 * activation is spent by the time the URL exists (which is why Download did
 * nothing, on desktop and phone alike). The server sends
 * `Content-Disposition: attachment`, so navigating an anchor saves the file
 * without leaving the app.
 */
export function saveFromLink(url: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.download = '';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
