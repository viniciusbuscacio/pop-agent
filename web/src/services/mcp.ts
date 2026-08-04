import type { McpServerDTO, McpServersResponse, McpServerResponse, McpTestResponse } from '@popy/shared';
import { apiRequest } from './api';
export const mcpService = {
  list: () => apiRequest<McpServersResponse>('/mcp/servers'),
  create: (body: unknown) => apiRequest<McpServerResponse>('/mcp/servers',{method:'POST',body}),
  update: (id:string,body:unknown) => apiRequest<McpServerResponse>(`/mcp/servers/${id}`,{method:'PUT',body}),
  remove: (id:string) => apiRequest<void>(`/mcp/servers/${id}`,{method:'DELETE'}),
  test: (id:string) => apiRequest<McpTestResponse>(`/mcp/servers/${id}/test`,{method:'POST'}),
  toggle: (id:string) => apiRequest<McpServerResponse>(`/mcp/servers/${id}/toggle`,{method:'POST'}),
};
export type { McpServerDTO };
