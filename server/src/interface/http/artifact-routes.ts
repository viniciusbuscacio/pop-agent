import { Hono } from 'hono';
import type { ArtifactDTO, ArtifactsResponse, ArtifactLinkResponse } from '@popy/shared';
import type { Artifact } from '../../domain/artifacts/artifact.js';
import type { ArtifactService } from '../../application/artifacts/artifact-service.js';
import { apiError } from './errors.js';

/**
 * Artifacts over HTTP, the authenticated half (popy.spec §14, RF-002/004).
 * List a conversation's artifacts, mint a signed download link, delete one.
 * The only identifier that leaves the server is the Artifact ID — never a
 * filesystem path or a storage key (RF-008).
 */
export interface ArtifactRoutesDeps {
  artifacts: ArtifactService;
}

export function createArtifactRoutes(deps: ArtifactRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/chats/:chatId/artifacts', (c) =>
    c.json({
      artifacts: deps.artifacts.list(c.req.param('chatId')).map(toDto),
    } satisfies ArtifactsResponse),
  );

  routes.post('/artifacts/:id/link', (c) => {
    const link = deps.artifacts.mintLink(c.req.param('id'));
    if (link === undefined) return apiError(c, 404, 'not_found', 'No such artifact.');
    return c.json({ url: link.url, expiresAt: link.expiresAt } satisfies ArtifactLinkResponse);
  });

  routes.delete('/artifacts/:id', (c) =>
    deps.artifacts.delete(c.req.param('id'))
      ? c.body(null, 204)
      : apiError(c, 404, 'not_found', 'No such artifact.'),
  );

  return routes;
}

function toDto(artifact: Artifact): ArtifactDTO {
  return {
    id: artifact.id,
    chatId: artifact.chatId,
    name: artifact.name,
    mime: artifact.mime,
    size: artifact.size,
    version: artifact.version,
    source: artifact.source,
    createdAt: artifact.createdAt,
  };
}
