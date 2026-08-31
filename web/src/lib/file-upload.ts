export const MAX_FILE_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface UploadFailure {
  name: string;
  reason: 'too-large' | 'failed';
}

/**
 * Sequential on purpose: a phone should not hold several 25 MiB multipart
 * requests in memory at once. One failed file does not discard the rest.
 */
export async function uploadFileBatch(
  files: File[],
  destination: (file: File) => string,
  upload: (file: File, dir: string) => Promise<unknown>,
  onProgress: (done: number, total: number) => void,
): Promise<UploadFailure[]> {
  const failures: UploadFailure[] = [];
  for (const [index, file] of files.entries()) {
    onProgress(index, files.length);
    if (file.size > MAX_FILE_UPLOAD_BYTES) {
      failures.push({ name: file.webkitRelativePath || file.name, reason: 'too-large' });
      continue;
    }
    try {
      await upload(file, destination(file));
    } catch {
      failures.push({ name: file.webkitRelativePath || file.name, reason: 'failed' });
    }
  }
  onProgress(files.length, files.length);
  return failures;
}
