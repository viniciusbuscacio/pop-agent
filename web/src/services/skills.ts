import type { SaveSkillRequest, SkillDTO, SkillsResponse } from '@popy/shared';
import { apiRequest } from './api';

export const skillsService = {
  list(): Promise<SkillsResponse> {
    return apiRequest<SkillsResponse>('/skills');
  },

  save(skill: SaveSkillRequest): Promise<SkillDTO> {
    return apiRequest<SkillDTO>(`/skills/${skill.slug}`, { method: 'PUT', body: skill });
  },

  remove(slug: string): Promise<void> {
    return apiRequest<void>(`/skills/${slug}`, { method: 'DELETE' });
  },
};
