import { create } from 'zustand';
import type { A2aAgentDTO, A2aTaskDTO } from '@pop-agent/shared';
import { a2aService } from '../services/a2a';

interface A2aState {
  agents: A2aAgentDTO[] | undefined;
  tasksByAgent: Record<string, A2aTaskDTO[] | undefined>;
  reload: () => Promise<void>;
  loadTasks: (agentId: string) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  replaceAgent: (agent: A2aAgentDTO) => void;
}

let reloadGeneration = 0;

export const useA2aStore = create<A2aState>((set, get) => ({
  agents: undefined,
  tasksByAgent: {},
  reload: async () => {
    const generation = ++reloadGeneration;
    try {
      const { agents } = await a2aService.list();
      if (generation === reloadGeneration) set({ agents });
    } catch {
      if (generation === reloadGeneration) set({ agents: get().agents ?? [] });
    }
  },
  loadTasks: async (agentId) => {
    try {
      const { tasks } = await a2aService.tasks(agentId);
      set((state) => ({ tasksByAgent: { ...state.tasksByAgent, [agentId]: tasks } }));
    } catch {
      set((state) => ({ tasksByAgent: { ...state.tasksByAgent, [agentId]: [] } }));
    }
  },
  toggle: async (id) => {
    const { agent } = await a2aService.toggle(id);
    get().replaceAgent(agent);
  },
  remove: async (id) => {
    await a2aService.remove(id);
    set((state) => {
      const tasksByAgent = { ...state.tasksByAgent };
      delete tasksByAgent[id];
      return {
        agents: (state.agents ?? []).filter((agent) => agent.id !== id),
        tasksByAgent,
      };
    });
  },
  replaceAgent: (agent) => {
    set((state) => ({
      agents: (state.agents ?? []).map((current) => current.id === agent.id ? agent : current),
    }));
  },
}));
