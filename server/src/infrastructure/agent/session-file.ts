/**
 * Opens pi's persisted JSONL when it still exists. Paths survive in SQLite, so
 * an install moved to a new data directory can legitimately retain a pointer
 * whose file is gone; that case starts fresh instead of bricking the chat.
 */
export function resumeOrCreate<T>(options: {
  sessionFile: string | undefined;
  create: () => T;
  open: (path: string) => T;
  onMissing?: (path: string) => void;
}): T {
  if (options.sessionFile === undefined || options.sessionFile.length === 0) {
    return options.create();
  }
  try {
    return options.open(options.sessionFile);
  } catch (error) {
    if (!isMissingFile(error)) throw error;
    options.onMissing?.(options.sessionFile);
    return options.create();
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}
