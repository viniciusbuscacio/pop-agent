import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

/** Render page one to canvas so the thumbnail works without a browser PDF plug-in. */
export async function renderPdfThumbnail(
  dataUri: string,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(dataUri, { signal });
  if (!response.ok) throw new Error('PDF thumbnail could not be decoded');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (signal.aborted) throw signal.reason;

  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const loading = pdfjs.getDocument({ data: bytes });
  const abortLoading = () => { void loading.destroy(); };
  signal.addEventListener('abort', abortLoading, { once: true });
  try {
    const pdf = await loading.promise;
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const availableWidth = canvas.parentElement?.clientWidth || 288;
    const availableHeight = canvas.parentElement?.clientHeight || 160;
    const cssScale = Math.min(availableWidth / natural.width, availableHeight / natural.height);
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
    signal.addEventListener('abort', abortRendering, { once: true });
    try {
      await rendering.promise;
    } finally {
      signal.removeEventListener('abort', abortRendering);
    }
  } finally {
    signal.removeEventListener('abort', abortLoading);
    await loading.destroy();
  }
}
