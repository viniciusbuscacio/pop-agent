import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, extname, isAbsolute, join, normalize, sep } from 'node:path';
import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { envelope, sanitize } from '../../domain/safety/sanitize.js';
import type { ArtifactService } from '../../application/artifacts/artifact-service.js';
import type { ArtifactExtractor } from './artifact-extractor.js';

/**
 * The agent's artifact tool (popy.spec §14, RF-001). The agent writes a file in
 * its workspace with the built-in `write`/`bash` tools; `save_artifact` then
 * promotes that file into a tracked, downloadable artifact for the current
 * conversation. The path is jailed to the workspace, so it can never reach out
 * to `secret.key` or anything else on disk.
 *
 * `defineTool` is passed in rather than imported so the SDK stays a single
 * dynamic import in the engine -- the fake bridge never loads pi at all.
 */

type DefineTool = (tool: ToolDefinition) => ToolDefinition;

/** Matches the upload cap (popy.spec §14): one artifact cannot fill the disk. */
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.html': 'text/html',
  '.zip': 'application/zip',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function mimeOf(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/** Text the agent can read inline; anything else is opened as bytes only. */
function isTextual(mime: string): boolean {
  return (
    mime.startsWith('text/') ||
    mime === 'application/json' ||
    mime === 'application/xml' ||
    mime === 'application/yaml' ||
    mime === 'image/svg+xml' ||
    mime === 'application/javascript' ||
    mime === 'application/x-yaml'
  );
}

/** A read artifact is external content, so it reaches the model as data. */
const MAX_INLINE_CHARS = 100_000;

function text(body: string): { content: [{ type: 'text'; text: string }]; details: undefined } {
  return { content: [{ type: 'text', text: body }], details: undefined };
}

/**
 * Resolves a workspace-relative path, refusing anything that escapes it --
 * lexically first (catches `..` and absolutes), then by real path so a symlink
 * pointing out of the workspace is followed and then refused.
 */
export function resolveInWorkspace(workspace: string, relativePath: string): string {
  const cleaned = relativePath.trim().replace(/\\/g, '/');
  if (cleaned.length === 0) throw new Error('A file path is required.');
  if (isAbsolute(cleaned) || cleaned.startsWith('/')) {
    throw new Error('The path must be relative to the workspace.');
  }
  if (cleaned.includes('\0')) throw new Error('The path cannot contain a null byte.');

  const root = realpathSync(workspace);
  const withSep = root.endsWith(sep) ? root : root + sep;
  const target = normalize(join(root, cleaned));
  if (target !== root && !target.startsWith(withSep)) {
    throw new Error('The path must stay inside the workspace.');
  }
  return target;
}

export interface FileSearch {
  search(query: string): Promise<{ artifactId: string; name: string; snippet: string; score: number }[]>;
}

export function buildArtifactTools(
  defineTool: DefineTool,
  artifacts: ArtifactService,
  workspace: string,
  chatId: string,
  extractor?: ArtifactExtractor,
  fileSearch?: FileSearch,
): ToolDefinition[] {
  const save = defineTool({
    name: 'save_artifact',
    label: 'Save an artifact',
    description:
      'Saves a file you created in the workspace as a downloadable artifact for this ' +
      'conversation. Pass the workspace-relative path; returns the artifact id the user ' +
      'can download from the conversation.',
    promptSnippet: 'save_artifact(path, name?) — save a workspace file as a downloadable artifact',
    parameters: Type.Object({
      path: Type.String({ description: 'Workspace-relative path to the file you created' }),
      name: Type.Optional(
        Type.String({ description: 'Display name for the download (defaults to the file name)' }),
      ),
    }),
    execute: (_id, params) => {
      const { path, name } = params as { path: string; name?: string };
      try {
        const resolved = resolveInWorkspace(workspace, path);
        const stat = statSync(resolved);
        if (!stat.isFile()) return Promise.resolve(text('That path is not a file.'));
        if (stat.size > MAX_ARTIFACT_BYTES) {
          return Promise.resolve(text('That file is too large to save as an artifact (25 MB max).'));
        }

        const bytes = readFileSync(resolved);
        const displayName = (name ?? basename(path)).trim();
        const artifact = artifacts.create(
          {
            chatId,
            name: displayName.length > 0 ? displayName : 'artifact',
            mime: mimeOf(path),
            source: 'agent',
          },
          bytes,
        );
        return Promise.resolve(
          text(
            `Saved "${artifact.name}" as artifact ${artifact.id} (${String(artifact.size)} bytes). ` +
              `The user can download it from this conversation's artifacts.`,
          ),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return Promise.resolve(text(`Could not save the artifact: ${message}`));
      }
    },
  });

  const read = defineTool({
    name: 'read_artifact',
    label: 'Read an artifact',
    description:
      'Reads an artifact from this conversation by its id (file-...) or by its exact name, ' +
      'and returns its text content. Binary files (images, archives, office docs) are reported ' +
      'but not inlined.',
    promptSnippet: 'read_artifact(ref) — read a conversation artifact by id or name',
    parameters: Type.Object({
      ref: Type.String({ description: 'The artifact id (file-...) or its exact name' }),
    }),
    execute: (_id, params) => {
      const { ref } = params as { ref: string };
      const query = ref.trim();

      // An id is scoped to this chat; a name resolves within this chat only, so
      // one conversation can never read another's artifacts.
      let target = query.startsWith('file-') ? artifacts.get(query) : undefined;
      if (target !== undefined && target.chatId !== chatId) target = undefined;
      target ??= artifacts.findByName(chatId, query);
      if (target === undefined) {
        return Promise.resolve(text(`No artifact "${query}" in this conversation.`));
      }

      const opened = artifacts.read(target.id);
      if (opened === undefined) {
        return Promise.resolve(text(`Artifact ${target.id} has no stored content.`));
      }

      const found = target;
      const guard = (body: string): string => envelope(sanitize(body).clean, `artifact:${found.id}`);

      if (isTextual(found.mime)) {
        return Promise.resolve(text(guard(opened.bytes.toString('utf8').slice(0, MAX_INLINE_CHARS))));
      }

      // Not plain text: try to extract (PDF/DOCX/OCR) before giving up.
      return (async () => {
        const extracted = extractor === undefined
          ? undefined
          : await extractor.extract(opened.bytes, found.mime, found.name);
        if (extracted !== undefined && extracted.trim().length > 0) {
          return text(guard(extracted.slice(0, MAX_INLINE_CHARS)));
        }
        return text(
          `${found.name} (${found.id}) is a ${found.mime} file of ${String(found.size)} bytes ` +
            `with no extractable text; offer the user a download instead.`,
        );
      })();
    },
  });

  if (fileSearch === undefined) return [save, read];

  const search = defineTool({
    name: 'files_search',
    label: 'Search the user files',
    description:
      "Semantic search over every file the user keeps in Files (uploads and saved artifacts, " +
      "all conversations). Returns the most relevant passages with the file they came from. " +
      "Use it when the user refers to something that may live in their documents.",
    promptSnippet: 'files_search(query) — search the content of the user\'s files',
    parameters: Type.Object({
      query: Type.String({ description: 'What to look for, in natural language' }),
    }),
    execute: async (_id, params) => {
      const { query } = params as { query: string };
      const hits = await fileSearch.search(query);
      if (hits.length === 0) return text('No file content matched.');
      const body = hits
        .map(
          (hit) =>
            `${hit.name} (${hit.artifactId}, score ${hit.score.toFixed(2)}):\n${hit.snippet}`,
        )
        .join('\n\n---\n\n');
      return text(envelope(sanitize(body).clean, 'files_search'));
    },
  });

  return [save, read, search];
}
