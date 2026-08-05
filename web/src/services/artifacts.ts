import type {
  ArtifactDTO,
  ArtifactsResponse,
  ArtifactLinkResponse,
  FolderDTO,
  FoldersResponse,
  FilesSearchResponse,
  TrashResponse,
} from '@popy/shared';
import { apiRequest, apiUpload } from './api';

/** Artifacts for a conversation (popy.spec §14, RF-002/009). */
export const artifactsService = {
  list(chatId: string): Promise<ArtifactsResponse> {
    return apiRequest<ArtifactsResponse>(`/chats/${chatId}/artifacts`);
  },

  /** Every artifact across every chat, newest first. */
  listAll(): Promise<ArtifactsResponse> {
    return apiRequest<ArtifactsResponse>('/artifacts');
  },

  upload(chatId: string, file: File): Promise<ArtifactDTO> {
    const form = new FormData();
    form.append('file', file);
    return apiUpload<ArtifactDTO>(`/chats/${chatId}/artifacts`, form);
  },

  /** Mints a fresh signed download URL (public, no session). */
  link(id: string): Promise<ArtifactLinkResponse> {
    return apiRequest<ArtifactLinkResponse>(`/artifacts/${id}/link`, { method: 'POST' });
  },

  /**
   * The same signed link, asking the server to display the file rather than
   * save it. The server has the last word: a type it will not show inline
   * (anything scriptable, anything it does not recognise) downloads as usual.
   */
  async viewUrl(id: string): Promise<string> {
    const { url } = await artifactsService.link(id);
    return `${url}&inline=1`;
  },

  remove(id: string): Promise<void> {
    return apiRequest<void>(`/artifacts/${id}`, { method: 'DELETE' });
  },

  /** Upload straight into Files (no chat); empty folderId = the root. */
  uploadToFiles(file: File, folderId: string): Promise<ArtifactDTO> {
    const form = new FormData();
    form.append('file', file);
    if (folderId.length > 0) form.append('folderId', folderId);
    return apiUpload<ArtifactDTO>('/artifacts', form);
  },

  rename(id: string, name: string): Promise<ArtifactDTO> {
    return apiRequest<ArtifactDTO>(`/artifacts/${id}`, { method: 'PATCH', body: { name } });
  },

  /** Moves a file to a folder; empty folderId = the root. */
  move(id: string, folderId: string): Promise<ArtifactDTO> {
    return apiRequest<ArtifactDTO>(`/artifacts/${id}`, { method: 'PATCH', body: { folderId } });
  },

  /**
   * Fetches a signed download link as bytes, with the filename the server put
   * in `Content-Disposition`.
   *
   * Here rather than in `lib/download` because the services layer is the only
   * door to the outside (popy.spec §14) -- a component reaching for `fetch`
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

  /** Searches folders and files by name or path, across the whole tree. */
  search(query: string): Promise<FilesSearchResponse> {
    return apiRequest<FilesSearchResponse>(`/files/search?q=${encodeURIComponent(query)}`);
  },
};

/**
 * The Files trash (popy.spec §14). The kind is in the path rather than
 * inferred from the id: a file and a folder fail for different reasons, and a
 * route that had to look in both tables would answer 404 for "it is a folder,
 * and its name is taken".
 */
export const trashService = {
  list(): Promise<TrashResponse> {
    return apiRequest<TrashResponse>('/trash');
  },

  restore(kind: 'file' | 'folder', id: string): Promise<void> {
    return apiRequest<void>(`/trash/${kind}s/${id}/restore`, { method: 'POST' });
  },

  /** Skips the retention window for one thing. */
  purge(kind: 'file' | 'folder', id: string): Promise<void> {
    return apiRequest<void>(`/trash/${kind}s/${id}`, { method: 'DELETE' });
  },

  empty(): Promise<void> {
    return apiRequest<void>('/trash', { method: 'DELETE' });
  },
};

/** Folders of the Files tab: a flat tree the user manages. */
export const foldersService = {
  list(): Promise<FoldersResponse> {
    return apiRequest<FoldersResponse>('/folders');
  },

  /** Creates a folder; empty parentId = the root of Files. */
  create(name: string, parentId = ''): Promise<FolderDTO> {
    return apiRequest<FolderDTO>('/folders', {
      method: 'POST',
      body: parentId.length > 0 ? { name, parentId } : { name },
    });
  },

  rename(id: string, name: string): Promise<void> {
    return apiRequest<void>(`/folders/${id}`, { method: 'PATCH', body: { name } });
  },

  /** Deletes the folder AND every file inside; confirm with the user first. */
  remove(id: string): Promise<void> {
    return apiRequest<void>(`/folders/${id}`, { method: 'DELETE' });
  },
};
