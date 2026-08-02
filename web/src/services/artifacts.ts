import type {
  ArtifactDTO,
  ArtifactsResponse,
  ArtifactLinkResponse,
  FolderDTO,
  FoldersResponse,
  FilesSearchResponse,
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

  /** Searches folders and files by name or path, across the whole tree. */
  search(query: string): Promise<FilesSearchResponse> {
    return apiRequest<FilesSearchResponse>(`/files/search?q=${encodeURIComponent(query)}`);
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
