import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './controls';
import { t } from '../i18n';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

/** Native modal focus handling, Escape and focus restoration; only mounted while open. */
export function ImagePreview({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return createPortal(
    <dialog ref={dialog} aria-label={name} onCancel={event => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none bg-[var(--bg)] p-0 text-[var(--screen-fg)] backdrop:bg-black/80">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <strong className="min-w-0 flex-1 truncate">{name}</strong>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('files.imageZoomOut')}
            disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom(current => Math.max(MIN_ZOOM, current - ZOOM_STEP))}
          >
            <span aria-hidden="true">−</span>
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('files.imageZoomIn')}
            disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom(current => Math.min(MAX_ZOOM, current + ZOOM_STEP))}
          >
            <span aria-hidden="true">+</span>
          </Button>
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.close')}</Button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" data-testid="image-preview-viewport">
          <div
            className="flex min-h-full min-w-full items-center justify-center"
            style={{ width: `${String(Math.max(1, zoom) * 100)}%`, height: `${String(Math.max(1, zoom) * 100)}%` }}
          >
            <img
              src={src}
              alt={name}
              className="max-h-full max-w-full object-contain"
              style={zoom < 1 ? { transform: `scale(${String(zoom)})` } : undefined}
              data-testid="image-preview-image"
            />
          </div>
        </div>
      </div>
    </dialog>, document.body,
  );
}
