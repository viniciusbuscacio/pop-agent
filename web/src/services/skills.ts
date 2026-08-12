import type {
  SaveSkillRequest,
  SkillDistillationAttemptDTO,
  SkillDistillationsResponse,
  SkillDTO,
  SkillsResponse,
} from '@pop-agent/shared';
import { apiRequest } from './api';

export const skillsService = {
  list(): Promise<SkillsResponse> {
    return apiRequest<SkillsResponse>('/skills');
  },

  distillations(limit = 30): Promise<SkillDistillationsResponse> {
    return apiRequest<SkillDistillationsResponse>(`/skills/distillations?limit=${String(limit)}`);
  },

  retryDistillation(id: string): Promise<SkillDistillationAttemptDTO> {
    return apiRequest<SkillDistillationAttemptDTO>(`/skills/distillations/${id}/retry`, { method: 'POST' });
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
