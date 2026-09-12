/**
 * Turns a persisted attachment body into a browser-owned object URL. Keeping
 * this browser integration in services matches the same boundary as Files
 * previews and avoids WebKit's unreliable PDF-in-data-URI frames.
 */
export async function attachmentPreviewUrl(
  dataUri: string,
  type: string,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(dataUri, signal === undefined ? {} : { signal });
  if (!response.ok) throw new Error('Attachment preview could not be decoded');
  const source = await response.blob();
  const blob = source.type === type ? source : new Blob([source], { type });
  return URL.createObjectURL(blob);
}
