import { useEffect, useState } from 'react';
import { t } from '../i18n';
import { filesService } from '../services/artifacts';
import { Button } from './controls';

export interface FileViewerProps {
  path: string;
  name: string;
  onClose: () => void;
}

type Preview = { kind: 'text'; content: string } | { kind: 'frame'; url: string };

/** Extensions the server maps to a safe plain-text inline response. */
const TEXT_EXTENSIONS = new Set([
  'css', 'csv', 'js', 'json', 'log', 'md', 'mjs', 'ts', 'txt', 'xml', 'yaml', 'yml',
]);

function isTextFile(name: string): boolean {
  const extension = name.split('.').at(-1)?.toLowerCase();
  return extension !== undefined && TEXT_EXTENSIONS.has(extension);
}

/**
 * Shows a safe, server-approved file inside the PWA.
 *
 * Text is fetched and painted by React so it inherits the app's theme, font
 * family and device font-size setting. Other browser-viewable formats retain
 * the isolated frame they need (PDF, media and images).
 */
export function FileViewer({ path, name, onClose }: FileViewerProps) {
  const [preview, setPreview] = useState<Preview>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    setPreview(undefined);
    setFailed(false);
    const pending: Promise<Preview> = isTextFile(name)
      ? filesService.textView(path).then((content) => ({ kind: 'text', content }))
      : filesService.viewUrl(path).then((url) => ({ kind: 'frame', url }));
    void pending.then(
      (next) => {
        if (live) setPreview(next);
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [name, path]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]"
      role="dialog"
      aria-modal="true"
      aria-label={name}
    >
      <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <strong className="min-w-0 flex-1 truncate text-sm">{name}</strong>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>
      {failed ? (
        <div
          className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[var(--muted)]"
          role="alert"
        >
          {t('files.openFailed')}
        </div>
      ) : preview === undefined ? (
        <div
          className="flex flex-1 items-center justify-center text-sm text-[var(--muted)]"
          role="status"
        >
          {t('app.loading')}
        </div>
      ) : preview.kind === 'text' ? (
        <pre
          data-testid="file-text-preview"
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-sans text-base leading-relaxed text-[var(--screen-fg)]"
        >
          {preview.content}
        </pre>
      ) : (
        <iframe
          className="min-h-0 flex-1 border-0 bg-[var(--bg)]"
          src={preview.url}
          title={name}
        />
      )}
    </div>
  );
}
