import type {
  FileLinkResponse,
  FileNodeDTO,
  FilesNameSearchResponse,
  FilesTreeResponse,
  GarbageEntryDTO,
  GarbageResponse,
} from '@pop-agent/shared';
import { apiRequest, apiUpload } from './api';

/**
 * Files as a plain folder (docs/specs/Spec-Pop-General.md §14): the tree is the disk, and a path
 * relative to the Files root IS the identifier -- there are no ids. Rename and
 * move are the same operation, a path edit.
 */
export const filesService = {
  tree(): Promise<FilesTreeResponse> {
    return apiRequest<FilesTreeResponse>('/files');
  },

  /** Live name matches across the whole tree, folders and files alike. */
  search(query: string): Promise<FilesNameSearchResponse> {
    return apiRequest<FilesNameSearchResponse>(`/files/search?q=${encodeURIComponent(query)}`);
  },

  /** Uploads into a folder; empty dir = the root. The server mkdir -p's. */
  upload(file: File, dir: string, signal?: AbortSignal): Promise<FileNodeDTO> {
    const form = new FormData();
    form.append('file', file);
    if (dir.length > 0) form.append('dir', dir);
    return apiUpload<FileNodeDTO>('/files', form, signal);
  },

  /** Creates the folder and every missing parent on the way (mkdir -p). */
  mkdir(path: string): Promise<void> {
    return apiRequest<void>('/files/folders', { method: 'POST', body: { path } });
  },

  /** A path edit: rename and move are the same thing. 409 = name_taken. */
  move(from: string, to: string): Promise<void> {
    return apiRequest<void>('/files/move', { method: 'POST', body: { from, to } });
  },

  /** Moves the entry into trash and returns its exact handle for immediate undo. */
  async remove(path: string): Promise<GarbageEntryDTO> {
    const removed = await apiRequest<GarbageEntryDTO | undefined>(
      `/files?path=${encodeURIComponent(path)}`,
      { method: 'DELETE' },
    );
    if (removed !== undefined) return removed;

    // During an update, a freshly loaded PWA can briefly meet the previous
    // server, whose DELETE returned 204. Its Trash listing still exposes the
    // collision-safe handle, so undo remains available across that boundary.
    const { entries } = await apiRequest<GarbageResponse>('/trash');
    const fallback = entries.find((entry) => entry.originalPath === path);
    if (fallback === undefined) throw new Error('The deleted entry was not found in Trash.');
    return fallback;
  },

  /** Mints a fresh signed download URL (public, no session). */
  async link(path: string): Promise<string> {
    const { url } = await apiRequest<FileLinkResponse>('/files/link', {
      method: 'POST',
      body: { path },
    });
    return url;
  },

  /**
   * The same signed link, asking the server to display the file rather than
   * save it. The server has the last word: a type it will not show inline
   * (anything scriptable, anything it does not recognise) downloads as usual.
   */
  async viewUrl(path: string): Promise<string> {
    const url = await filesService.link(path);
    return `${url}&inline=1`;
  },

  /**
   * Reads a server-approved plain-text preview into the PWA itself. This keeps
   * Markdown and other text on the app's theme and font scale instead of
   * flashing Safari's separate white, monospace document viewer.
   */
  async textView(path: string): Promise<string> {
    const response = await fetch(await filesService.viewUrl(path), {
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`Preview failed (${String(response.status)})`);
    const type = response.headers.get('content-type')?.toLowerCase() ?? '';
    const disposition = response.headers.get('content-disposition')?.toLowerCase() ?? '';
    if (!type.startsWith('text/plain') || !disposition.startsWith('inline')) {
      throw new Error('The server did not approve this file as plain text.');
    }
    return response.text();
  },

  /**
   * Fetches a signed download link as bytes, with the filename the server put
   * in `Content-Disposition`.
   *
   * Here rather than in `lib/download` because the services layer is the only
   * door to the outside (docs/specs/Spec-Pop-General.md §14) -- a component reaching for `fetch`
   * fails the gate, and the rule is right: this is an HTTP call, and HTTP
   * calls live behind a named function whose signature says what it returns.
   *
   * The link is already authorised by its HMAC, so no session travels with it.
   */
  async blob(url: string): Promise<{ blob: Blob; filename: string }> {
    const response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Download failed (${String(response.status)})`);
    const header = response.headers.get('content-disposition') ?? '';
    const match = /filename="?([^";]+)"?/i.exec(header);
    return { blob: await response.blob(), filename: match?.[1] ?? 'download' };
  },
};

/**
 * The Files trash (docs/specs/Spec-Pop-General.md §14): Files/Garbage/ over HTTP. The entry's name
 * inside Garbage/ is the handle for restore and purge.
 */
export const trashService = {
  list(): Promise<GarbageResponse> {
    return apiRequest<GarbageResponse>('/trash');
  },

  restore(name: string): Promise<void> {
    return apiRequest<void>(`/trash/${encodeURIComponent(name)}/restore`, { method: 'POST' });
  },

  /** Skips the retention window for one thing. */
  purge(name: string): Promise<void> {
    return apiRequest<void>(`/trash/${encodeURIComponent(name)}`, { method: 'DELETE' });
  },

  empty(): Promise<{ purged: number }> {
    return apiRequest<{ purged: number }>('/trash', { method: 'DELETE' });
  },
};
