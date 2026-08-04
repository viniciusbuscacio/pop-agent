import { create } from 'zustand';
import type { McpServerDTO } from '@popy/shared';
import { mcpService } from '../services/mcp';
interface McpState { servers: McpServerDTO[]|undefined; reload:()=>Promise<void>; }
export const useMcpStore=create<McpState>((set,get)=>({servers:undefined,reload:async()=>{try{set({servers:(await mcpService.list()).servers});}catch{set({servers:get().servers??[]});}}}));
