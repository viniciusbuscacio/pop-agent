import type {
  ChatDTO,
  ChatListResponse,
  MessagesResponse,
  ModelsResponse,
  PatchChatRequest,
  SendMessageResponse,
  StopRunResponse,
} from '@popy/shared';
import { apiRequest } from './api';

export const chatsService = {
  list(archived = false): Promise<ChatListResponse> {
    return apiRequest<ChatListResponse>(`/chats?archived=${String(archived)}`);
  },

  create(): Promise<ChatDTO> {
    return apiRequest<ChatDTO>('/chats', { method: 'POST' });
  },

  patch(id: string, patch: PatchChatRequest): Promise<ChatDTO> {
    return apiRequest<ChatDTO>(`/chats/${id}`, { method: 'PATCH', body: patch });
  },

  remove(id: string): Promise<void> {
    return apiRequest<void>(`/chats/${id}`, { method: 'DELETE' });
  },

  messages(id: string, before?: string): Promise<MessagesResponse> {
    const query = before === undefined ? '' : `?before=${encodeURIComponent(before)}`;
    return apiRequest<MessagesResponse>(`/chats/${id}/messages${query}`);
  },

  send(id: string, text: string): Promise<SendMessageResponse> {
    return apiRequest<SendMessageResponse>(`/chats/${id}/messages`, {
      method: 'POST',
      body: { text },
    });
  },

  stop(id: string): Promise<StopRunResponse> {
    return apiRequest<StopRunResponse>(`/chats/${id}/stop`, { method: 'POST' });
  },

  models(): Promise<ModelsResponse> {
    return apiRequest<ModelsResponse>('/models');
  },
};
