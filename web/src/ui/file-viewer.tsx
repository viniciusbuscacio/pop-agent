import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { filesService } from '../services/artifacts';
import { Button } from './controls';

export interface FileViewerProps {
  path: string;
  name: string;
  onClose: () => void;
}

/**
 * Shows a safe, server-approved file inside the PWA.
 *
 * iOS standalone PWAs do not reliably honour `window.open`: depending on the
 * release they either block it or create an unreachable blank webview. Keeping
 * the viewer in our own full-screen dialog works there and also gives the user
 * an explicit way back instead of navigating the installed app to a raw file.
 */
export function FileViewer({ path, name, onClose }: FileViewerProps) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setUrl(undefined);
    setFailed(false);
    void filesService.viewUrl(path).then(
      (next) => {
        if (live) setUrl(next);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [path]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--screen-bg)]" role="dialog" aria-modal="true" aria-label={name}>
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <strong className="min-w-0 flex-1 truncate text-sm">{name}</strong>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
      {failed ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[var(--muted)]" role="alert">
          {t('files.openFailed')}
        </div>
      ) : url === undefined ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]" role="status">
          {t('app.loading')}
        </div>
      ) : (
        <iframe className="min-h-0 flex-1 border-0 bg-white" src={url} title={name} />
      )}
    </div>
  );
}
