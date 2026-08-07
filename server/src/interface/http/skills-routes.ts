import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { SkillDTO, SkillsResponse } from '@popy/shared';
import type { Skill } from '../../domain/skills/skill.js';
import { SkillsError, type SkillsRepo } from '../../application/ports/skills-repo.js';
import type { SkillUsage, SkillUsageRepo } from '../../application/ports/skill-usage-repo.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';

/**
 * The skills CRUD (popy.spec §8): Settings → Skills lists them, lets the user
 * write their own and edit any, and delete their own. The Skill Router reads
 * the same vault to decide which fire per turn.
 */

const saveSchema = z
  .object({
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,48}$/),
    name: z.string().min(1).max(120),
    description: z.string().max(500),
    whenToUse: z.string().max(500),
    body: z.string().max(20_000),
    pinned: z.boolean().optional(),
  })
  .strict();

export interface SkillsRoutesDeps {
  skills: SkillsRepo;
  /** Use counts, merged into the list so the screen can show what earns its slot. */
  usage?: SkillUsageRepo;
}

export function createSkillsRoutes(deps: SkillsRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/skills', (c) => {
    const usage = new Map((deps.usage?.all() ?? []).map((entry) => [entry.slug, entry]));
    return c.json({
      skills: deps.skills.all().map((skill) => toDto(skill, usage.get(skill.slug))),
    } satisfies SkillsResponse);
  });

  // Accepting a pending skill (popy.spec §8). A POST with no body: the only
  // thing being said is "yes", and there is nothing else to send.
  routes.post('/skills/:slug/approve', (c) => {
    const skill = deps.skills.approve(c.req.param('slug'));
    return skill === undefined
      ? apiError(c, 404, 'not_found', 'No such skill.')
      : c.json(toDto(skill));
  });

  const save = async (c: Context): Promise<Response> => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const { pinned, ...fields } = parsed.data;
    try {
      return c.json(toDto(deps.skills.write({ ...fields, ...(pinned === undefined ? {} : { pinned }) })));
    } catch (error) {
      if (error instanceof SkillsError) {
        return apiError(c, 400, 'invalid_field', error.message);
      }
      throw error;
    }
  };

  routes.post('/skills', save);
  routes.put('/skills/:slug', save);

  routes.delete('/skills/:slug', (c) => {
    try {
      return deps.skills.delete(c.req.param('slug'))
        ? c.body(null, 204)
        : apiError(c, 404, 'not_found', 'No such skill.');
    } catch (error) {
      if (error instanceof SkillsError) {
        return apiError(c, 409, 'operation_error', error.message);
      }
      throw error;
    }
  });

  return routes;
}

function toDto(skill: Skill, usage?: SkillUsage): SkillDTO {
  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    body: skill.body,
    source: skill.source,
    ...(skill.pinned === true ? { pinned: true } : {}),
    ...(skill.pending === true ? { pending: true } : {}),
    ...(usage === undefined ? {} : { useCount: usage.useCount, lastUsedAt: usage.lastUsedAt }),
  };
}
