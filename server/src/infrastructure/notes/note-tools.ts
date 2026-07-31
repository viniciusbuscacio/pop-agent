import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { envelope, sanitize } from '../../domain/safety/sanitize.js';
import { NoteJailError } from './note-jail.js';
import type { NotesVault } from './notes-vault.js';

/**
 * The agent's notes tools (popy.spec §11). Read paths through the vault's jail
 * and hand the model what it asked for; write is on by default because the
 * vault is the agent's own. Everything a tool returns from a note goes through
 * sanitize + envelope first: a note can hold text pasted from anywhere, and
 * the model must read it as data, not as instructions.
 *
 * `sdk.defineTool` is passed in rather than imported here so the SDK stays a
 * single dynamic import in the engine -- an install on the fake bridge never
 * loads pi at all.
 */

type DefineTool = (tool: ToolDefinition) => ToolDefinition;

function text(body: string): { content: [{ type: 'text'; text: string }]; details: undefined } {
  return { content: [{ type: 'text', text: body }], details: undefined };
}

/** Wraps note content as sanitized, untrusted data before the model sees it. */
function asData(body: string, source: string): string {
  return envelope(sanitize(body).clean, source);
}

export function buildNoteTools(defineTool: DefineTool, vault: NotesVault): ToolDefinition[] {
  const list = defineTool({
    name: 'notes_list',
    label: 'List notes',
    description: 'Lists every note in your vault, as vault-relative paths.',
    promptSnippet: 'notes_list() — list your notes',
    parameters: Type.Object({}),
    execute: () => {
      const notes = vault.list();
      return Promise.resolve(
        text(notes.length === 0 ? '(the vault is empty)' : notes.join('\n')),
      );
    },
  });

  const read = defineTool({
    name: 'notes_read',
    label: 'Read a note',
    description: 'Reads one note from your vault by its vault-relative path (must end in .md).',
    promptSnippet: 'notes_read(path) — read a note',
    parameters: Type.Object({ path: Type.String({ description: 'Vault-relative .md path' }) }),
    execute: (_id, params) => {
      const { path } = params as { path: string };
      try {
        return Promise.resolve(text(asData(vault.read(path), `note:${path}`)));
      } catch (error) {
        return Promise.resolve(errorResult(error));
      }
    },
  });

  const search = defineTool({
    name: 'notes_search',
    label: 'Search notes',
    description: 'Searches your notes for a phrase and returns the matching lines.',
    promptSnippet: 'notes_search(query) — search your notes',
    parameters: Type.Object({ query: Type.String({ description: 'Text to look for' }) }),
    execute: (_id, params) => {
      const { query } = params as { query: string };
      const hits = vault.search(query);
      if (hits.length === 0) return Promise.resolve(text('(no matching notes)'));
      const body = hits.map((hit) => `${hit.path}:${String(hit.line)}: ${hit.text}`).join('\n');
      return Promise.resolve(text(asData(body, 'notes:search')));
    },
  });

  const write = defineTool({
    name: 'notes_write',
    label: 'Write a note',
    description:
      'Creates or overwrites a note in your vault (path must end in .md). Folders are created as needed.',
    promptSnippet: 'notes_write(path, content) — save a note',
    parameters: Type.Object({
      path: Type.String({ description: 'Vault-relative .md path' }),
      content: Type.String({ description: 'The full markdown content' }),
    }),
    execute: (_id, params) => {
      const { path, content } = params as { path: string; content: string };
      try {
        const saved = vault.write(path, content);
        return Promise.resolve(text(`Saved ${saved}.`));
      } catch (error) {
        return Promise.resolve(errorResult(error));
      }
    },
  });

  return [list, read, search, write];
}

function errorResult(error: unknown): {
  content: [{ type: 'text'; text: string }];
  details: undefined;
  isError: true;
} {
  const message =
    error instanceof NoteJailError
      ? error.message
      : error instanceof Error
        ? error.message
        : 'The note could not be accessed.';
  return { ...text(message), isError: true };
}
