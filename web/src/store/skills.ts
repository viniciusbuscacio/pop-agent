import { create } from 'zustand';
import type { SkillDTO } from '@popy/shared';
import { skillsService } from '../services/skills';

/**
 * Skills, shared between the sidebar list and the right-hand editor pane so a
 * save or a delete on one side shows on the other at once -- the same shape as
 * the files store, for the same explorer layout (popy.spec §8, §14).
 */
interface SkillsState {
  skills: SkillDTO[] | undefined;
  reload: () => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: undefined,
  reload: async () => {
    try {
      set({ skills: (await skillsService.list()).skills });
    } catch {
      // Keep what is on screen; the next load is authoritative.
      set({ skills: get().skills ?? [] });
    }
  },
}));
