export const MAX_FILE_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface UploadFailure {
  file: File;
  destination: string;
  name: string;
  reason: 'too-large' | 'failed';
}

export interface UploadBatchResult {
  failures: UploadFailure[];
  cancelled: boolean;
}

/**
 * Sequential on purpose: a phone should not hold several 100 MiB multipart
 * requests in memory at once. Transient failures get one immediate retry; a
 * failure still does not discard the rest of the batch.
 */
export async function uploadFileBatch(
  files: File[],
  destination: (file: File) => string,
  upload: (file: File, dir: string, signal?: AbortSignal) => Promise<unknown>,
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<UploadBatchResult> {
  const failures: UploadFailure[] = [];
  let completed = 0;
  let cancelled = false;
  onProgress(completed, files.length);

  for (const file of files) {
    if (signal?.aborted === true) {
      cancelled = true;
      break;
    }
    const dir = destination(file);
    const name = file.webkitRelativePath || file.name;
    if (file.size > MAX_FILE_UPLOAD_BYTES) {
      failures.push({ file, destination: dir, name, reason: 'too-large' });
      completed += 1;
      onProgress(completed, files.length);
      continue;
    }

    let uploaded = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await upload(file, dir, signal);
        uploaded = true;
        break;
      } catch (error) {
        if (isAbort(error) || isSignalAborted(signal)) {
          cancelled = true;
          break;
        }
        if (attempt === 0 && isTransient(error)) continue;
        failures.push({ file, destination: dir, name, reason: 'failed' });
        break;
      }
    }
    if (cancelled) break;
    if (uploaded || failures.some((failure) => failure.file === file)) completed += 1;
    onProgress(completed, files.length);
  }

  return { failures, cancelled };
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function isTransient(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; status?: unknown };
  return candidate.code === 'server_unreachable'
    || candidate.status === 429
    || (typeof candidate.status === 'number' && candidate.status >= 500);
}
