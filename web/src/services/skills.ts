import type { SaveSkillRequest, SkillDTO, SkillsResponse } from '@pop-agent/shared';
import { apiRequest } from './api';

export const skillsService = {
  list(): Promise<SkillsResponse> {
    return apiRequest<SkillsResponse>('/skills');
  },

  save(skill: SaveSkillRequest): Promise<SkillDTO> {
    return apiRequest<SkillDTO>(`/skills/${skill.slug}`, { method: 'PUT', body: skill });
  },

  /** Brings a skill the collector archived back into the router. */
  restore(slug: string): Promise<SkillDTO> {
    return apiRequest<SkillDTO>(`/skills/${slug}/restore`, { method: 'POST' });
  },

  remove(slug: string): Promise<void> {
    return apiRequest<void>(`/skills/${slug}`, { method: 'DELETE' });
  },

  setEnabled(slug: string, enabled: boolean): Promise<SkillDTO> {
    return apiRequest<SkillDTO>(`/skills/${slug}/enabled`, { method: 'POST', body: { enabled } });
  },
};
