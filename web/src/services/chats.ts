import type {
  ArchiveOtherChatsResponse,
  AttachmentDTO,
  ChatDTO,
  ExecutionMode,
  ChatListResponse,
  ConfirmResponse,
  DeleteOtherChatsResponse,
  MessagesResponse,
  MessageDelivery,
  ModelsResponse,
  RecentModelsResponse,
  PatchChatRequest,
  QueuedMessageDTO,
  SendMessageResponse,
  StopRunResponse,
} from '@pop-agent/shared';
import { apiRequest } from './api';

export const chatsService = {
  list(archived = false): Promise<ChatListResponse> {
    return apiRequest<ChatListResponse>(`/chats?archived=${String(archived)}`);
  },

  create(): Promise<ChatDTO> {
    return apiRequest<ChatDTO>('/chats', { method: 'POST' });
  },

  archiveOthers(keepChatId: string): Promise<ArchiveOtherChatsResponse> {
    return apiRequest<ArchiveOtherChatsResponse>('/chats/archive-others', {
      method: 'POST',
      body: { keepChatId },
    });
  },

  deleteOthers(keepChatId: string): Promise<DeleteOtherChatsResponse> {
    return apiRequest<DeleteOtherChatsResponse>('/chats/delete-others', {
      method: 'POST',
      body: { keepChatId },
    });
  },

  patch(id: string, patch: PatchChatRequest): Promise<ChatDTO> {
    return apiRequest<ChatDTO>(`/chats/${id}`, { method: 'PATCH', body: patch });
  },

  removeArchived(): Promise<{ deleted: number }> {
    return apiRequest<{ deleted: number }>('/chats/archived', { method: 'DELETE' });
  },

  remove(id: string): Promise<void> {
    return apiRequest<void>(`/chats/${id}`, { method: 'DELETE' });
  },

  messages(id: string, before?: string): Promise<MessagesResponse> {
    const query = before === undefined ? '' : `?before=${encodeURIComponent(before)}`;
    return apiRequest<MessagesResponse>(`/chats/${id}/messages${query}`);
  },

  send(
    id: string,
    text: string,
    attachments: AttachmentDTO[] = [],
    filePaths: string[] = [],
    delivery: MessageDelivery = 'steer',
    executionMode: ExecutionMode = 'normal',
  ): Promise<SendMessageResponse> {
    return apiRequest<SendMessageResponse>(`/chats/${id}/messages`, {
      method: 'POST',
      body: {
        text,
        ...(delivery === 'steer' ? {} : { delivery }),
        ...(executionMode === 'normal' ? {} : { executionMode }),
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(filePaths.length > 0 ? { filePaths } : {}),
      },
    });
  },

  updateQueue(
    id: string,
    messageId: string,
    text: string,
    attachments: AttachmentDTO[] = [],
    filePaths: string[] = [],
  ): Promise<{ message: QueuedMessageDTO }> {
    return apiRequest<{ message: QueuedMessageDTO }>(`/chats/${id}/queue/${messageId}`, {
      method: 'PUT',
      body: {
        text,
        ...(attachments.length > 0 ? { attachments } : {}),
        ...(filePaths.length > 0 ? { filePaths } : {}),
      },
    });
  },

  cancelQueue(id: string, messageId: string): Promise<void> {
    return apiRequest<void>(`/chats/${id}/queue/${messageId}`, { method: 'DELETE' });
  },

  stop(id: string): Promise<StopRunResponse> {
    return apiRequest<StopRunResponse>(`/chats/${id}/stop`, { method: 'POST' });
  },

  confirm(id: string, runId: string, allow: boolean): Promise<ConfirmResponse> {
    return apiRequest<ConfirmResponse>(`/chats/${id}/confirm`, {
      method: 'POST',
      body: { runId, allow },
    });
  },

  models(providerId?: string): Promise<ModelsResponse> {
    return apiRequest<ModelsResponse>(
      providerId === undefined ? '/models' : `/models?provider=${providerId}`,
    );
  },

  recentModels(): Promise<RecentModelsResponse> {
    return apiRequest<RecentModelsResponse>('/recent-models');
  },
};
