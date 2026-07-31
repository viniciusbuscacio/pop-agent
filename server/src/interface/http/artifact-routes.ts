import { Hono } from 'hono';
import type { ArtifactDTO, ArtifactsResponse, ArtifactLinkResponse } from '@popy/shared';
import type { Artifact } from '../../domain/artifacts/artifact.js';
import type { ArtifactService } from '../../application/artifacts/artifact-service.js';
import type { ChatService } from '../../application/chat/chat-service.js';
import { apiError } from './errors.js';

/** An upload is capped so one request cannot fill the disk (popy.spec §14). */
const MAX_ARTIFACT_MB = 25;
const MAX_ARTIFACT_BYTES = MAX_ARTIFACT_MB * 1024 * 1024;

/**
 * Artifacts over HTTP, the authenticated half (popy.spec §14, RF-002/004).
 * List a conversation's artifacts, mint a signed download link, delete one.
 * The only identifier that leaves the server is the Artifact ID — never a
 * filesystem path or a storage key (RF-008).
 */
export interface ArtifactRoutesDeps {
  artifacts: ArtifactService;
  chats: ChatService;
}

export function createArtifactRoutes(deps: ArtifactRoutesDeps): Hono {
  const routes = new Hono();

  routes.get('/chats/:chatId/artifacts', (c) =>
    c.json({
      artifacts: deps.artifacts.list(c.req.param('chatId')).map(toDto),
    } satisfies ArtifactsResponse),
  );

  // Upload a file straight into a conversation (RF-009). Multipart, so the
  // bytes are not base64-inflated across the wire.
  routes.post('/chats/:chatId/artifacts', async (c) => {
    const chatId = c.req.param('chatId');
    if (deps.chats.get(chatId) === undefined) return apiError(c, 404, 'not_found', 'No such chat.');

    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      return apiError(c, 400, 'bad_request', 'Expected a "file" upload.');
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) return apiError(c, 400, 'bad_request', 'The file is empty.');
    if (bytes.length > MAX_ARTIFACT_BYTES) {
      return apiError(c, 413, 'too_large', `Files must be ${String(MAX_ARTIFACT_MB)} MB or less.`);
    }

    const artifact = deps.artifacts.create(
      {
        chatId,
        name: file.name.length > 0 ? file.name : 'upload',
        mime: file.type.length > 0 ? file.type : 'application/octet-stream',
        source: 'upload',
      },
      bytes,
    );
    return c.json(toDto(artifact), 201);
  });

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
