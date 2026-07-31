import { Hono } from 'hono';
import { z } from 'zod';
import type {
  ArtifactDTO,
  ArtifactsResponse,
  ArtifactLinkResponse,
  ArtifactVersionsResponse,
  FoldersResponse,
} from '@popy/shared';
import type { Artifact } from '../../domain/artifacts/artifact.js';
import type { ArtifactService } from '../../application/artifacts/artifact-service.js';
import type { ChatService } from '../../application/chat/chat-service.js';
import { apiError } from './errors.js';
import { badBody, readJson, schemaError } from './body.js';

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

  // Every artifact across every chat -- the Artefacts segment of the home list.
  routes.get('/artifacts', (c) =>
    c.json({ artifacts: deps.artifacts.listAll().map(toDto) } satisfies ArtifactsResponse),
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

  // Upload a file straight into Files (no chat): the Files tab's Upload
  // button. An optional folderId form field lands it inside a folder.
  routes.post('/artifacts', async (c) => {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      return apiError(c, 400, 'bad_request', 'Expected a "file" upload.');
    }
    const folderId = typeof body['folderId'] === 'string' ? body['folderId'] : '';

    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.length === 0) return apiError(c, 400, 'bad_request', 'The file is empty.');
    if (bytes.length > MAX_ARTIFACT_BYTES) {
      return apiError(c, 413, 'too_large', `Files must be ${String(MAX_ARTIFACT_MB)} MB or less.`);
    }

    const artifact = deps.artifacts.create(
      {
        chatId: '',
        folderId,
        name: file.name.length > 0 ? file.name : 'upload',
        mime: file.type.length > 0 ? file.type : 'application/octet-stream',
        source: 'upload',
      },
      bytes,
    );
    return c.json(toDto(artifact), 201);
  });

  // Rename and/or move a file.
  routes.patch('/artifacts/:id', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = artifactPatchSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);

    const id = c.req.param('id');
    if (deps.artifacts.get(id) === undefined) return apiError(c, 404, 'not_found', 'No such artifact.');
    if (parsed.data.name !== undefined) deps.artifacts.rename(id, parsed.data.name);
    if (parsed.data.folderId !== undefined && !deps.artifacts.move(id, parsed.data.folderId)) {
      return apiError(c, 404, 'not_found', 'No such folder.');
    }
    const updated = deps.artifacts.get(id);
    return updated === undefined
      ? apiError(c, 404, 'not_found', 'No such artifact.')
      : c.json(toDto(updated));
  });

  // Folders: a flat tree the user manages from the Files tab.
  routes.get('/folders', (c) =>
    c.json({ folders: deps.artifacts.listFolders() } satisfies FoldersResponse),
  );

  routes.post('/folders', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = folderSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    try {
      return c.json(deps.artifacts.createFolder(parsed.data.name), 201);
    } catch {
      return apiError(c, 409, 'conflict', 'A folder with that name already exists.');
    }
  });

  routes.patch('/folders/:id', async (c) => {
    const body = await readJson(c);
    if (body === undefined) return badBody(c);
    const parsed = folderSchema.safeParse(body);
    if (!parsed.success) return schemaError(c, parsed.error);
    try {
      return deps.artifacts.renameFolder(c.req.param('id'), parsed.data.name)
        ? c.json({ ok: true })
        : apiError(c, 404, 'not_found', 'No such folder.');
    } catch {
      return apiError(c, 409, 'conflict', 'A folder with that name already exists.');
    }
  });

  // Deletes the folder AND every file in it; the UI warns first.
  routes.delete('/folders/:id', (c) =>
    deps.artifacts.deleteFolder(c.req.param('id'))
      ? c.body(null, 204)
      : apiError(c, 404, 'not_found', 'No such folder.'),
  );

  routes.post('/artifacts/:id/link', (c) => {
    const link = deps.artifacts.mintLink(c.req.param('id'));
    if (link === undefined) return apiError(c, 404, 'not_found', 'No such artifact.');
    return c.json({ url: link.url, expiresAt: link.expiresAt } satisfies ArtifactLinkResponse);
  });

  routes.get('/artifacts/:id/versions', (c) => {
    if (deps.artifacts.get(c.req.param('id')) === undefined) {
      return apiError(c, 404, 'not_found', 'No such artifact.');
    }
    return c.json({
      versions: deps.artifacts.listVersions(c.req.param('id')),
    } satisfies ArtifactVersionsResponse);
  });

  routes.post('/artifacts/:id/versions/:version/link', (c) => {
    const version = Number(c.req.param('version'));
    if (!Number.isInteger(version)) return apiError(c, 400, 'bad_request', 'Bad version.');
    const link = deps.artifacts.mintVersionLink(c.req.param('id'), version);
    if (link === undefined) return apiError(c, 404, 'not_found', 'No such artifact version.');
    return c.json({ url: link.url, expiresAt: link.expiresAt } satisfies ArtifactLinkResponse);
  });

  routes.delete('/artifacts/:id', (c) =>
    deps.artifacts.delete(c.req.param('id'))
      ? c.body(null, 204)
      : apiError(c, 404, 'not_found', 'No such artifact.'),
  );

  return routes;
}

const folderSchema = z.object({ name: z.string().min(1).max(120) }).strict();
const artifactPatchSchema = z
  .object({ name: z.string().min(1).max(255).optional(), folderId: z.string().max(60).optional() })
  .strict();

function toDto(artifact: Artifact): ArtifactDTO {
  return {
    id: artifact.id,
    chatId: artifact.chatId,
    folderId: artifact.folderId,
    name: artifact.name,
    mime: artifact.mime,
    size: artifact.size,
    version: artifact.version,
    source: artifact.source,
    createdAt: artifact.createdAt,
  };
}
