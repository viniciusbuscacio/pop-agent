import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { envelope, sanitize } from '../../domain/safety/sanitize.js';
import type { FilesService } from '../../application/files/files-service.js';

/**
 * The agent's Files tools (popy.spec §14, "Files as a plain folder").
 *
 * Files is a real folder now -- `Files/` in the workspace -- so the built-in
 * read/write/bash tools cover creating and reading. What remains as custom
 * tools is what must NOT be raw filesystem work:
 *
 * - `delete_file` moves into the Garbage instead of removing, so the user
 *   keeps thirty days to change their mind. A rule enforced by a tool beats a
 *   rule taught in a prompt (Vinicius, 05/08) -- the prompt merely says
 *   "never rm in Files/", this makes obeying easier than disobeying.
 * - `files_search` finds names without walking the tree by hand: cheap for a
 *   weak model, and the filenames come back inside the safety envelope
 *   (they are the user's data, not instructions).
 *
 * `defineTool` is passed in rather than imported so the SDK stays a single
 * dynamic import in the engine -- the fake bridge never loads pi at all.
 */

type DefineTool = (tool: ToolDefinition) => ToolDefinition;

const MAX_HITS = 40;

function text(body: string): { content: [{ type: 'text'; text: string }]; details: undefined } {
  return { content: [{ type: 'text', text: body }], details: undefined };
}

/** Accepts `Files/reports/a.pdf` as well as `reports/a.pdf`: the agent sees the folder as `Files/`. */
function stripPrefix(path: string): string {
  const cleaned = path.trim();
  return cleaned.startsWith('Files/') ? cleaned.slice('Files/'.length) : cleaned;
}

export function buildFileTools(defineTool: DefineTool, files: FilesService): ToolDefinition[] {
  const deleteFile = defineTool({
    name: 'delete_file',
    label: 'Delete a user file',
    description:
      "Deletes a file or folder from the user's Files (the Files/ folder in your workspace) " +
      'by moving it to the trash, where the user can restore it for 30 days. ALWAYS use this ' +
      'to delete inside Files/ -- never rm or unlink, which would destroy the file for good. ' +
      "Pass the path relative to Files/, e.g. 'reports/old.pdf'.",
    promptSnippet: 'delete_file(path) — move a Files/ entry to the trash (never rm there)',
    parameters: Type.Object({
      path: Type.String({ description: "Path inside Files/, e.g. 'reports/old.pdf'" }),
    }),
    execute: (_id, params) => {
      const { path } = params as { path: string };
      try {
        const relative = stripPrefix(path);
        const outcome = files.remove(relative);
        if (outcome === 'not-found') {
          return Promise.resolve(text(`No file or folder "${relative}" in Files.`));
        }
        return Promise.resolve(
          text(`Moved "${relative}" to the Files trash. The user can restore it for 30 days.`),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown error';
        return Promise.resolve(text(`Could not delete: ${message}`));
      }
    },
  });

  const search = defineTool({
    name: 'files_search',
    label: 'Search the user files',
    description:
      "Searches the user's Files by name: every file or folder whose path contains the query, " +
      'case-insensitive. Use it when the user refers to a document that may live in their ' +
      'Files. Returns paths relative to Files/.',
    promptSnippet: "files_search(query) — find the user's files by name",
    parameters: Type.Object({
      query: Type.String({ description: 'Part of a file or folder name' }),
    }),
    execute: (_id, params) => {
      const { query } = params as { query: string };
      if (query.trim().length === 0) return Promise.resolve(text('A search term is required.'));

      const hits = files
        .searchNames(query, MAX_HITS)
        .map((hit) => (hit.kind === 'dir' ? `${hit.path}/` : hit.path));

      if (hits.length === 0) return Promise.resolve(text('No file name matched.'));
      return Promise.resolve(text(envelope(sanitize(hits.join('\n')).clean, 'files_search')));
    },
  });

  return [deleteFile, search];
}
