export interface DroppedFiles {
  files: Array<{ file: File; directory: string }>;
  emptyDirectories: string[];
}

/** Capture entries during the drop event: the browser clears its data store afterwards. */
export async function collectDroppedFiles(data: DataTransfer, signal?: AbortSignal): Promise<DroppedFiles> {
  const items = Array.from(data.items ?? []).filter(item => item.kind === 'file');
  const roots = items.map(item => ({
    entry: item.webkitGetAsEntry?.() ?? null,
    file: item.getAsFile(),
  }));
  const fallback = Array.from(data.files);
  const result: DroppedFiles = { files: [], emptyDirectories: [] };
  const check = () => signal?.throwIfAborted();
  async function walk(entry: FileSystemEntry, parent: string): Promise<void> {
    check();
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      check(); result.files.push({ file, directory: parent });
    } else if (entry.isDirectory) {
      const path = parent ? `${parent}/${entry.name}` : entry.name;
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      let empty = true;
      // Chromium returns batches (often 100), not the complete directory.
      for (;;) {
        check();
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        check();
        if (batch.length === 0) break;
        empty = false;
        for (const child of batch) await walk(child, path);
      }
      if (empty) result.emptyDirectories.push(path);
    }
  }
  if (roots.length === 0) {
    for (const file of fallback) result.files.push({ file, directory: '' });
  } else {
    for (const root of roots) {
      check();
      if (root.entry) await walk(root.entry, '');
      else if (root.file) result.files.push({ file: root.file, directory: '' });
      else throw new Error('The browser did not provide the dropped item.');
    }
  }
  check(); return result;
}
