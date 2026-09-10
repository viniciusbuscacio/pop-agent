import { filesService } from '../services/artifacts';
import { t } from '../i18n';

/** Claim the tab during the click, then open an authenticated local preview. */
export function viewFromLink(pending: Promise<string>): void {
  const tab = window.open('about:blank', '_blank');
  if (tab !== null) tab.opener = null;
  void pending.then(
    (url) => {
      if (tab === null || tab.closed) saveObjectUrl(url, 'download');
      else {
        tab.location.replace(url);
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    },
    () => { tab?.close(); window.alert(t('files.openFailed')); },
  );
}

/** Fetch using the current session; never fall back to unauthenticated navigation. */
export function saveFromLink(url: string): void {
  void filesService.blob(url).then(
    ({ blob, filename }) => saveObjectUrl(URL.createObjectURL(blob), filename),
    () => window.alert(t('files.downloadFailed')),
  );
}

function saveObjectUrl(url: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Safari can consume the blob after the click returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
