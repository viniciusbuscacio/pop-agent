import type { Context } from 'hono';
import type { z } from 'zod';
import { apiError } from './errors.js';

/**
 * Request-body plumbing shared by the routes: read JSON, and turn a Zod
 * failure into the project's error envelope with a code the frontend can
 * branch on (popy.spec §13).
 */

export async function readJson(c: Context): Promise<unknown> {
  try {
    return (await c.req.json()) as unknown;
  } catch {
    return undefined;
  }
}

export function badBody(c: Context): Response {
  return apiError(c, 400, 'missing_field', 'This endpoint expects a JSON body.');
}

/**
 * `missing_field` when something required is absent or the wrong type;
 * `invalid_field` when the body carries something the endpoint does not
 * accept, which under `.strict()` is how a typo or a stale client shows up.
 */
export function schemaError(c: Context, error: z.ZodError): Response {
  const issues = error.issues;
  if (issues.some((issue) => issue.code === 'unrecognized_keys')) {
    return apiError(c, 400, 'invalid_field', 'The request carries a field Popy does not accept.');
  }
  if (issues.some((issue) => issue.code === 'invalid_type')) {
    return apiError(c, 400, 'missing_field', 'The request is missing a required field.');
  }
  return apiError(c, 400, 'invalid_field', 'The request has a field Popy cannot accept.');
}
