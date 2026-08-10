import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type {
  DistillerStatusDTO,
  SkillDistillationAttemptDTO,
  SkillDTO,
  SkillsResponse,
} from '@pop-agent/shared';
import { entityId } from '../../domain/ids.js';
import type { Skill } from '../../domain/skills/skill.js';
import {
  SkillsError,
  type SkillArchiveRepo,
  type SkillsRepo,
} from '../../application/ports/skills-repo.js';
import type { SkillUsage, SkillUsageRepo } from '../../application/ports/skill-usage-repo.js';
import type {
  DistillationAttempt,
  DistillationRepo,
  SkillRevision,
  SkillRevisionsRepo,
} from '../../application/ports/skill-distillation-repo.js';
import { badBody, readJson, schemaError } from './body.js';
import { apiError } from './errors.js';

/**
 * The skills CRUD (pop-agent.spec §8): Settings → Skills lists them, lets the user
 * write their own and edit any, and delete their own. The Skill Router reads
 * the same vault to decide which fire per turn.
 *
 * Since fase (c) the screen is also the distiller's inbox. Two things wait
 * here for a yes: a new skill, held out of the router by its `pending` flag,
 * and a rewrite of a skill that already works, held out by living in its own
 * table. Both are approved with a POST that carries no body, because the only
 * thing being said is yes.
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

const enabledSchema = z.object({ enabled: z.boolean() }).strict();

export interface SkillsRoutesDeps {
  skills: SkillsRepo;
  /** Use counts, merged into the list so the screen can show what earns its slot. */
  usage?: SkillUsageRepo;
  /** Proposed rewrites waiting for a yes (pop-agent.spec §8, fase c). */
  revisions?: SkillRevisionsRepo;
  /** The archive the collector fills, and the way back out of it. */
  archive?: SkillArchiveRepo;
  /** Where the distiller's watermarks live; only its clock is read here. */
  distillation?: DistillationRepo;
  /** Whether the distiller is switched on at all, for the status line. */
  distillerEnabled?: () => boolean;
  /** Clock for auditable retry admission; production passes the system clock. */
  now?: () => number;
}

export function createSkillsRoutes(deps: SkillsRoutesDeps): Hono {
  const routes = new Hono();

  const listing = (): SkillsResponse => {
    const usage = new Map((deps.usage?.all() ?? []).map((entry) => [entry.slug, entry]));
    const revisions = new Map((deps.revisions?.all() ?? []).map((entry) => [entry.slug, entry]));
    const skills = deps.skills
      .all()
      .map((skill) => toDto(skill, usage.get(skill.slug), revisions.get(skill.slug)));
    const lastRunAt = deps.distillation?.lastRunAt();
    const status: DistillerStatusDTO = {
      enabled: deps.distillerEnabled?.() ?? false,
      ...(lastRunAt === undefined ? {} : { lastRunAt }),
      pending: skills.filter((skill) => skill.pending === true).length,
      revisions: revisions.size,
    };
    return {
      skills,
      archived: (deps.archive?.archived() ?? []).map((skill) => toDto(skill)),
      distiller: status,
    };
  };

  routes.get('/skills', (c) => c.json(listing()));

  routes.get('/skills/distillations', (c) => {
    const raw = Number(c.req.query('limit') ?? 30);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 100) : 30;
    return c.json({
      attempts: (deps.distillation?.attempts(limit) ?? []).map(toAttemptDto),
    });
  });

  routes.post('/skills/distillations/:id/retry', (c) => {
    const at = new Date(deps.now?.() ?? Date.now()).toISOString();
    const retry = deps.distillation?.queueRetry(c.req.param('id'), entityId('distillation'), at);
    return retry === undefined
      ? apiError(c, 409, 'operation_error', 'That distillation cannot be retried.')
      : c.json(toAttemptDto(retry), 202);
  });

  // Accepting a pending skill (pop-agent.spec §8). A POST with no body: the only
  // thing being said is "yes", and there is nothing else to send.
  routes.post('/skills/:slug/approve', (c) => {
    const skill = deps.skills.approve(c.req.param('slug'));
    return skill === undefined
      ? apiError(c, 404, 'not_found', 'No such skill.')
      : c.json(toDto(skill));
  });

  /**
   * Accepting a proposed rewrite. `source` is passed back explicitly so this
   * does not read as a human edit: the vault promotes an auto skill to `user`
   * when it is edited, and saying yes to the distiller's rewrite is not that.
   */
  routes.post('/skills/:slug/revision/approve', (c) => {
    const slug = c.req.param('slug');
    const revision = deps.revisions?.get(slug);
    const current = deps.skills.get(slug);
    if (revision === undefined || current === undefined) {
      return apiError(c, 404, 'not_found', 'No revision is waiting for that skill.');
    }
    const saved = deps.skills.write({
      slug,
      name: revision.name,
      description: revision.description,
      whenToUse: revision.whenToUse,
      body: revision.body,
      source: current.source,
      ...(current.pinned === true ? { pinned: true } : {}),
      pending: false,
    });
    deps.revisions?.delete(slug);
    return c.json(toDto(saved));
  });

  /** Declining one. The skill keeps the version it had; nothing else changes. */
  routes.delete('/skills/:slug/revision', (c) => {
    const slug = c.req.param('slug');
    if (deps.revisions?.get(slug) === undefined) {
      return apiError(c, 404, 'not_found', 'No revision is waiting for that skill.');
    }
    deps.revisions.delete(slug);
    return c.body(null, 204);
  });

  /** Out of the archive and back into the router (pop-agent.spec §8). */
  routes.post('/skills/:slug/restore', (c) => {
    const restored = deps.archive?.restore(c.req.param('slug'));
    return restored === undefined
      ? apiError(c, 404, 'not_found', 'No such archived skill.')
      : c.json(toDto(restored));
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

  routes.post('/skills/:slug/enabled', async (c) => {
    const slug = c.req.param('slug');
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = enabledSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    if (!deps.skills.setEnabled(slug, parsed.data.enabled)) {
      return apiError(c, 404, 'not_found', 'No such skill.');
    }
    const skill = deps.skills.get(slug);
    return skill === undefined
      ? apiError(c, 404, 'not_found', 'No such skill.')
      : c.json(toDto(skill));
  });

  routes.delete('/skills/:slug', (c) => {
    const slug = c.req.param('slug');
    try {
      if (!deps.skills.delete(slug)) return apiError(c, 404, 'not_found', 'No such skill.');
      // A skill that is gone has no version to review. Left behind, the
      // proposal would reappear the day a new skill happened to take the slug.
      deps.revisions?.delete(slug);
      return c.body(null, 204);
    } catch (error) {
      if (error instanceof SkillsError) {
        return apiError(c, 409, 'operation_error', error.message);
      }
      throw error;
    }
  });

  return routes;
}

function toAttemptDto(attempt: DistillationAttempt): SkillDistillationAttemptDTO {
  // A provider/parser failure may succeed unchanged on another pass. `nothing`
  // and `tainted` are completed policy decisions over an exact immutable window;
  // presenting retry there turns normal maintenance into apparent user work.
  const retryable = attempt.state === 'failed' || attempt.outcome === 'invalid_output';
  return {
    id: attempt.id,
    chatId: attempt.chatId,
    chatTitle: attempt.chatTitle,
    trigger: attempt.trigger,
    state: attempt.state,
    ...(attempt.outcome === undefined ? {} : { outcome: attempt.outcome }),
    ...(attempt.riskLevel === undefined ? {} : { riskLevel: attempt.riskLevel }),
    warnings: attempt.warnings,
    ...(attempt.errorCode === undefined ? {} : { errorCode: attempt.errorCode }),
    ...(attempt.errorMessage === undefined ? {} : { errorMessage: attempt.errorMessage }),
    ...(attempt.retryOf === undefined ? {} : { retryOf: attempt.retryOf }),
    startedAt: attempt.startedAt,
    ...(attempt.finishedAt === undefined ? {} : { finishedAt: attempt.finishedAt }),
    results: attempt.results,
    retryable,
  };
}

function toDto(skill: Skill, usage?: SkillUsage, revision?: SkillRevision): SkillDTO {
  return {
    slug: skill.slug,
    name: skill.name,
    description: skill.description,
    whenToUse: skill.whenToUse,
    body: skill.body,
    source: skill.source,
    ...(skill.pinned === true ? { pinned: true } : {}),
    ...(skill.pending === true ? { pending: true } : {}),
    ...(skill.enabled === false ? { enabled: false } : {}),
    ...(usage === undefined ? {} : { useCount: usage.useCount, lastUsedAt: usage.lastUsedAt }),
    ...(revision === undefined
      ? {}
      : {
          proposedRevision: {
            name: revision.name,
            description: revision.description,
            whenToUse: revision.whenToUse,
            body: revision.body,
            createdAt: revision.createdAt,
            ...(revision.similarity === undefined ? {} : { similarity: revision.similarity }),
          },
        }),
  };
}
