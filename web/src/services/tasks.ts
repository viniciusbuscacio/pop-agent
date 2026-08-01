import type {
  CreateTaskRequest,
  RunTaskNowResponse,
  TaskDTO,
  TasksResponse,
  UpdateTaskRequest,
} from '@popy/shared';
import { apiRequest } from './api';

/** Background tasks over the API (popy.spec §21). */
export const tasksService = {
  list(): Promise<TasksResponse> {
    return apiRequest<TasksResponse>('/tasks');
  },

  get(id: string): Promise<TaskDTO> {
    return apiRequest<TaskDTO>(`/tasks/${id}`);
  },

  create(task: CreateTaskRequest): Promise<TaskDTO> {
    return apiRequest<TaskDTO>('/tasks', { method: 'POST', body: task });
  },

  update(id: string, patch: UpdateTaskRequest): Promise<TaskDTO> {
    return apiRequest<TaskDTO>(`/tasks/${id}`, { method: 'PATCH', body: patch });
  },

  remove(id: string): Promise<void> {
    return apiRequest<void>(`/tasks/${id}`, { method: 'DELETE' });
  },

  toggle(id: string, enabled: boolean): Promise<TaskDTO> {
    return apiRequest<TaskDTO>(`/tasks/${id}/toggle`, { method: 'POST', body: { enabled } });
  },

  runNow(id: string): Promise<RunTaskNowResponse> {
    return apiRequest<RunTaskNowResponse>(`/tasks/${id}/run-now`, { method: 'POST' });
  },
};
