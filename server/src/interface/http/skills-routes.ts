import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { SkillDTO, SkillsResponse } from '@popy/shared';
import type { Skill } from '../../domain/skills/skill.js';
import { SkillsError, type SkillsRepo } from '../../application/ports/skills-repo.js';
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
  })
  .strict();

export interface SkillsRoutesDeps {
  skills: SkillsRepo;
}

export function createSkillsRoutes(deps: SkillsRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/skills', (c) =>
    c.json({ skills: deps.skills.all().map(toDto) } satisfies SkillsResponse),
  );

  const save = async (c: Context): Promise<Response> => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    try {
      return c.json(toDto(deps.skills.write(parsed.data)));
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

function toDto(skill: Skill): SkillDTO {
  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    body: skill.body,
    builtin: skill.builtin,
  };
}
