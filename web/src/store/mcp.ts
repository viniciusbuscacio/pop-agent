import { create } from 'zustand';
import type { McpServerDTO } from '@pop-agent/shared';
import { mcpService } from '../services/mcp';
interface McpState {
  servers: McpServerDTO[] | undefined;
  error: string | undefined;
  reload: () => Promise<void>;
}
let reloadGeneration = 0;

export const useMcpStore = create<McpState>((set, get) => ({
  servers: undefined,
  error: undefined,
  reload: async () => {
    const generation = ++reloadGeneration;
    try {
      const servers = (await mcpService.list()).servers;
      if (generation === reloadGeneration) set({ servers, error: undefined });
    } catch (error) {
      if (generation === reloadGeneration) {
        set({
          servers: get().servers ?? [],
          error: error instanceof Error ? error.message : 'MCP servers could not be loaded.',
        });
      }
    }
  },
}));
