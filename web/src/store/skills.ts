import { create } from 'zustand';
import type { SkillDTO } from '@pop-agent/shared';
import { skillsService } from '../services/skills';

/** Which slice of the roster the sidebar list shows. Persisted in the store, not the URL. */
export type SkillSourceFilter = 'all' | 'personal' | 'auto' | 'builtin';

/** Absent means enabled; only an explicit `false` switches a skill off (§8). */
export function skillEnabled(skill: SkillDTO): boolean {
  return skill.enabled !== false;
}

export function matchesSourceFilter(skill: SkillDTO, filter: SkillSourceFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'personal':
      return skill.source === 'user';
    case 'auto':
      return skill.source === 'auto';
    case 'builtin':
      return skill.source === 'builtin';
  }
}

/**
 * Skills, shared between the sidebar list and the right-hand editor pane so a
 * save or a delete on one side shows on the other at once -- the same shape as
 * the files store, for the same explorer layout (pop-agent.spec §8, §14).
 */
interface SkillsState {
  skills: SkillDTO[] | undefined;
  sourceFilter: SkillSourceFilter;
  setSourceFilter: (filter: SkillSourceFilter) => void;
  upsertSkill: (skill: SkillDTO) => void;
  reload: () => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: undefined,
  sourceFilter: 'all',
  setSourceFilter: (filter) => set({ sourceFilter: filter }),
  upsertSkill: (skill) =>
    set((state) => ({
      skills: state.skills?.map((entry) => (entry.slug === skill.slug ? skill : entry)) ?? [skill],
    })),
  reload: async () => {
    try {
      set({ skills: (await skillsService.list()).skills });
    } catch {
      // Keep what is on screen; the next load is authoritative.
      set({ skills: get().skills ?? [] });
    }
  },
}));
