import type { ArtifactDTO, ArtifactsResponse, ArtifactLinkResponse } from '@popy/shared';
import { apiRequest, apiUpload } from './api';

/** Artifacts for a conversation (popy.spec §14, RF-002/009). */
export const artifactsService = {
  list(chatId: string): Promise<ArtifactsResponse> {
    return apiRequest<ArtifactsResponse>(`/chats/${chatId}/artifacts`);
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
};
