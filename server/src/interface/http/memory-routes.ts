import { Hono } from 'hono';
import { z } from 'zod';
import type { UserMemoryDTO } from '@pop-agent/shared';
import type { UserMemoryRepo } from '../../application/ports/user-memory-repo.js';
import { badBody, readJson, schemaError } from './body.js';

/**
 * The living user-memory document over HTTP (pop-agent.spec §13): Settings → Memory
 * shows it, lets the user edit it, and restore the one-level backup. The agent
 * edits the same document through its own tools.
 */

const MAX_DOC = 8_000;
const putSchema = z.object({ doc: z.string().max(MAX_DOC) }).strict();

export interface MemoryRoutesDeps {
  userMemory: UserMemoryRepo;
}

export function createMemoryRoutes(deps: MemoryRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/memory', (c) => c.json(toDto(deps.userMemory.read())));

  routes.put('/memory', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = putSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    deps.userMemory.write(parsed.data.doc);
    return c.json(toDto(deps.userMemory.read()));
  });

  routes.post('/memory/restore', (c) => {
    deps.userMemory.restoreBackup();
    return c.json(toDto(deps.userMemory.read()));
  });

  return routes;
}

function toDto(memory: { doc: string; backup: string }): UserMemoryDTO {
  return { doc: memory.doc, hasBackup: memory.backup.length > 0 };
}
