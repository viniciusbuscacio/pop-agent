import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button, Pressable } from './controls';
import { t } from '../i18n';
import { loadPdfDocument, renderPdfThumbnail, type PdfDocumentHandle } from '../services/pdf-thumbnail';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

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

/** Full-screen PDF.js canvas viewer; only mounted while open. */
export function PdfPreview({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PdfDocumentHandle>();
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.focus({ preventScroll: true });
    return () => element?.close();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let live = true;
    let loaded: PdfDocumentHandle | undefined;
    setPdf(undefined);
    setPage(1);
    setFailed(false);
    void loadPdfDocument(src, controller.signal).then(
      document => {
        loaded = document;
        if (live) setPdf(document);
        else void document.destroy();
      },
      () => { if (live && !controller.signal.aborted) setFailed(true); },
    );
    return () => {
      live = false;
      controller.abort();
      if (loaded !== undefined) void loaded.destroy();
    };
  }, [src]);
  useLayoutEffect(() => {
    const document = pdf;
    const element = canvas.current;
    const container = viewport.current;
    if (document === undefined || element === null || container === null) return;
    const controller = new AbortController();
    setReady(false);
    setFailed(false);
    void document.renderPage(page, element, {
      width: Math.max(1, container.clientWidth - 16),
      height: Math.max(1, container.clientHeight - 16),
      zoom,
    }, controller.signal).then(
      () => setReady(true),
      () => { if (!controller.signal.aborted) setFailed(true); },
    );
    return () => controller.abort();
  }, [page, pdf, zoom]);
  return createPortal(
    <dialog ref={dialog} tabIndex={-1} aria-label={name} onCancel={event => { event.preventDefault(); onClose(); }}
      className="fixed inset-0 m-0 h-[100dvh] max-h-none w-screen max-w-none bg-[var(--bg)] p-0 text-[var(--screen-fg)] outline-none backdrop:bg-black/80">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <strong className="min-w-0 flex-1 truncate">{name}</strong>
          <Button type="button" variant="ghost" aria-label={t('files.imageZoomOut')} disabled={zoom <= MIN_ZOOM}
            onClick={() => setZoom(current => Math.max(MIN_ZOOM, current - ZOOM_STEP))}>−</Button>
          <Button type="button" variant="ghost" aria-label={t('files.imageZoomIn')} disabled={zoom >= MAX_ZOOM}
            onClick={() => setZoom(current => Math.min(MAX_ZOOM, current + ZOOM_STEP))}>+</Button>
          <Button type="button" variant="ghost" onClick={onClose}>{t('common.close')}</Button>
        </div>
        <div ref={viewport} className="relative min-h-0 flex-1 overflow-auto p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]" data-testid="pdf-preview-viewport">
          <div className="flex min-h-full min-w-full items-center justify-center">
            <canvas ref={canvas} data-testid="pdf-preview-canvas" aria-label={`${name}, ${t('files.pdfPageCount', { page, count: pdf?.pageCount ?? 1 })}`}
              className={ready ? 'bg-white shadow-lg' : 'invisible absolute'} />
            {failed ? <div className="text-center text-sm text-[var(--muted)]" role="alert">{t('files.openFailed')}</div>
              : ready ? null : <div className="text-sm text-[var(--muted)]" role="status">{t('app.loading')}</div>}
          </div>
        </div>
        {pdf !== undefined && pdf.pageCount > 1 ? (
          <div className="flex shrink-0 items-center justify-center gap-3 border-t border-[var(--border)] p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            <Button type="button" variant="ghost" aria-label={t('files.pdfPreviousPage')} disabled={page <= 1}
              onClick={() => setPage(current => Math.max(1, current - 1))}>←</Button>
            <span className="text-sm text-[var(--muted)]">{t('files.pdfPageCount', { page, count: pdf.pageCount })}</span>
            <Button type="button" variant="ghost" aria-label={t('files.pdfNextPage')} disabled={page >= pdf.pageCount}
              onClick={() => setPage(current => Math.min(pdf.pageCount, current + 1))}>→</Button>
          </div>
        ) : null}
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
