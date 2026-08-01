import { create } from 'zustand';
import type { TaskDTO } from '@popy/shared';
import { tasksService } from '../services/tasks';

/**
 * The background-task list (popy.spec §21), shared by the sidebar and the
 * full-screen form so a save on one is visible on the other without a reload.
 *
 * `undefined` means "not loaded yet", which is what tells the list apart from
 * an install that genuinely has no tasks.
 */
interface TasksState {
  tasks: TaskDTO[] | undefined;
  reload: () => Promise<void>;
  toggle: (id: string, enabled: boolean) => Promise<void>;
  remove: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
}

export const useTasksStore = create<TasksState>((set, get) => ({
  tasks: undefined,

  reload: async () => {
    try {
      const { tasks } = await tasksService.list();
      set({ tasks });
    } catch {
      set({ tasks: [] });
    }
  },

  toggle: async (id, enabled) => {
    const updated = await tasksService.toggle(id, enabled);
    set({ tasks: (get().tasks ?? []).map((task) => (task.id === id ? updated : task)) });
  },

  remove: async (id) => {
    await tasksService.remove(id);
    set({ tasks: (get().tasks ?? []).filter((task) => task.id !== id) });
  },

  runNow: async (id) => {
    await tasksService.runNow(id);
    // The run is queued, not finished: what the row shows next is whatever the
    // server has once it is over, so the list is refreshed rather than guessed.
  },
}));
