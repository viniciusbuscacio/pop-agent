import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Pressable } from './controls';
import { t } from '../i18n';
import { attachmentPreviewUrl } from '../services/attachment-preview';
import { renderPdfThumbnail } from '../services/pdf-thumbnail';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

function useAttachmentObjectUrl(src: string, type: string): { url?: string; failed: boolean } {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setFailed(false);
    void attachmentPreviewUrl(src, type, controller.signal).then(
      next => {
        objectUrl = next;
        if (live) setUrl(next);
        else URL.revokeObjectURL(next);
      },
      () => { if (live) setFailed(true); },
    );
    return () => {
      live = false;
      controller.abort();
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [src, type]);
  return { ...(url === undefined ? {} : { url }), failed };
}

export function PdfThumbnail({ src, name, onOpen }: { src: string; name: string; onOpen: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const controller = new AbortController();
    setReady(false);
    setFailed(false);
    void renderPdfThumbnail(src, element, controller.signal).then(
      () => setReady(true),
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [src]);
  return (
    <div className="w-72 max-w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel-bg)]" data-testid="pdf-thumbnail">
      <div className="relative flex h-40 items-center justify-center overflow-hidden bg-white">
        <canvas
          ref={canvas}
          aria-hidden="true"
          data-testid="pdf-thumbnail-canvas"
          className={ready ? 'max-h-full max-w-full' : 'invisible absolute'}
        />
        {failed ? (
          <div className="flex h-full items-center justify-center p-3 text-center text-xs text-[var(--muted)]">
            {t('files.openFailed')}
          </div>
        ) : ready ? null : (
          <div className="flex h-full items-center justify-center text-xs text-[var(--muted)]">{t('app.loading')}</div>
        )}
        <Pressable
          type="button"
          aria-label={`${t('files.preview')}: ${name}`}
          onClick={onOpen}
          className="absolute inset-0 cursor-pointer bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
        >
          <span className="sr-only">{`${t('files.preview')}: ${name}`}</span>
        </Pressable>
      </div>
      <div className="truncate border-t border-[var(--border)] px-2 py-1.5 text-xs text-[var(--muted)]">{name}</div>
    </div>
  );
}

/** Native modal focus handling, Escape and focus restoration; only mounted while open. */
export function PdfPreview({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { url, failed } = useAttachmentObjectUrl(src, 'application/pdf');
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.focus({ preventScroll: true });
    return () => element?.close();
  }, []);
  return createPortal(
    <dialog ref={dialog} tabIndex={-1} aria-label={name} onCancel={event => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none bg-[var(--bg)] p-0 text-[var(--screen-fg)] outline-none backdrop:bg-black/80">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <strong className="min-w-0 flex-1 truncate">{name}</strong>
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.close')}</Button>
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
          <iframe
            src={url}
            title={name}
            data-testid="pdf-preview-frame"
            className="min-h-0 flex-1 border-0 bg-[var(--bg)]"
          />
        )}
      </div>
    </dialog>, document.body,
  );
}

export function ImagePreview({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    // Keep the browser from auto-focusing Close (and painting a focus ring)
    // when the preview opens. Keyboard users still reach every action with Tab.
    element?.focus({ preventScroll: true });
    return () => element?.close();
  }, []);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (element === null) return;
    // Expanding the canvas otherwise grows only toward the right/bottom from
    // the browser's current origin. Recenter after every zoom step.
    element.scrollLeft = Math.max(0, (element.scrollWidth - element.clientWidth) / 2);
    element.scrollTop = Math.max(0, (element.scrollHeight - element.clientHeight) / 2);
  }, [zoom]);
  return createPortal(
    <dialog ref={dialog} tabIndex={-1} aria-label={name} onCancel={event => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none bg-[var(--bg)] p-0 text-[var(--screen-fg)] outline-none backdrop:bg-black/80">
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
        <div ref={viewport} className="min-h-0 flex-1 overflow-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" data-testid="image-preview-viewport">
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
