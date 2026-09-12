import type { Context } from 'hono';
import type { ApiError } from '@pop-agent/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Every failure leaves the API in the same envelope (docs/specs/Spec-Pop-General.md §13), so the
 * frontend maps one shape and switches on `code` instead of parsing prose.
 */
export function apiError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
): Response {
  const body: ApiError = { error: { code, message, status } };
  return c.json(body, status);
}
