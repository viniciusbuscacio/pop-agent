import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export interface PdfDocumentHandle {
  pageCount: number;
  renderPage: (
    pageNumber: number,
    canvas: HTMLCanvasElement,
    bounds: { width: number; height: number; zoom?: number },
    signal: AbortSignal,
  ) => Promise<void>;
  destroy: () => Promise<void>;
}

/** Load a PDF without depending on the browser's built-in PDF plug-in. */
export async function loadPdfDocument(dataUri: string, signal: AbortSignal): Promise<PdfDocumentHandle> {
  const response = await fetch(dataUri, { signal });
  if (!response.ok) throw new Error('PDF could not be decoded');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loading = pdfjs.getDocument({ data: bytes });
  const abortLoading = () => { void loading.destroy(); };
  signal.addEventListener('abort', abortLoading, { once: true });
  try {
    const pdf = await loading.promise;
    if (signal.aborted) {
      await loading.destroy();
      throw new DOMException('Aborted', 'AbortError');
    }
    return {
      pageCount: pdf.numPages,
      async renderPage(pageNumber, canvas, bounds, renderSignal) {
        const page = await pdf.getPage(pageNumber);
        if (renderSignal.aborted) throw new DOMException('Aborted', 'AbortError');
        const natural = page.getViewport({ scale: 1 });
        const fitScale = Math.min(bounds.width / natural.width, bounds.height / natural.height);
        const cssScale = fitScale * (bounds.zoom ?? 1);
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = page.getViewport({ scale: cssScale * pixelRatio });
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('Canvas is unavailable');

        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        canvas.style.width = `${String(viewport.width / pixelRatio)}px`;
        canvas.style.height = `${String(viewport.height / pixelRatio)}px`;

        const rendering = page.render({ canvas, canvasContext: context, viewport });
        const abortRendering = () => rendering.cancel();
        renderSignal.addEventListener('abort', abortRendering, { once: true });
        try {
          await rendering.promise;
        } finally {
          renderSignal.removeEventListener('abort', abortRendering);
          page.cleanup();
        }
      },
      async destroy() { await loading.destroy(); },
    };
  } finally {
    signal.removeEventListener('abort', abortLoading);
  }
}

/** Render page one to canvas for the bounded chat thumbnail. */
export async function renderPdfThumbnail(
  dataUri: string,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<void> {
  const pdf = await loadPdfDocument(dataUri, signal);
  try {
    await pdf.renderPage(1, canvas, {
      width: canvas.parentElement?.clientWidth || 288,
      height: canvas.parentElement?.clientHeight || 160,
    }, signal);
  } finally {
    await pdf.destroy();
  }
}
