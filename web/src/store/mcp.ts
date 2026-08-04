import { create } from 'zustand';
import type { McpServerDTO } from '@popy/shared';
import { mcpService } from '../services/mcp';
interface McpState { servers: McpServerDTO[]|undefined; reload:()=>Promise<void>; }
let reloadGeneration = 0;

export const useMcpStore = create<McpState>((set, get) => ({
  servers: undefined,
  reload: async () => {
    const generation = ++reloadGeneration;
    try {
      const servers = (await mcpService.list()).servers;
      if (generation === reloadGeneration) set({ servers });
    } catch {
      if (generation === reloadGeneration) set({ servers: get().servers ?? [] });
    }
  },
}));
