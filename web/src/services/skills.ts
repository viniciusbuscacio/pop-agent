import type { SaveSkillRequest, SkillDTO, SkillsResponse } from '@pop-agent/shared';
import { apiRequest } from './api';

export const skillsService = {
  list(): Promise<SkillsResponse> {
    return apiRequest<SkillsResponse>('/skills');
  },

  save(skill: SaveSkillRequest): Promise<SkillDTO> {
    return apiRequest<SkillDTO>(`/skills/${skill.slug}`, { method: 'PUT', body: skill });
  },

  /** Accepts a pending skill into the router (pop-agent.spec §8). */
  approve(slug: string): Promise<SkillDTO> {
    return apiRequest<SkillDTO>(`/skills/${slug}/approve`, { method: 'POST' });
  },

  /** Accepts the distiller's rewrite of a skill that already works (§8, fase c). */
  approveRevision(slug: string): Promise<SkillDTO> {
    return apiRequest<SkillDTO>(`/skills/${slug}/revision/approve`, { method: 'POST' });
  },

  /** Declines it: the skill keeps the version it has. */
  discardRevision(slug: string): Promise<void> {
    return apiRequest<void>(`/skills/${slug}/revision`, { method: 'DELETE' });
  },

  /** Brings a skill the collector archived back into the router. */
  restore(slug: string): Promise<SkillDTO> {
    return apiRequest<SkillDTO>(`/skills/${slug}/restore`, { method: 'POST' });
  },

  remove(slug: string): Promise<void> {
    return apiRequest<void>(`/skills/${slug}`, { method: 'DELETE' });
  },
};
