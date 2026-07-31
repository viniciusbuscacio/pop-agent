import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { UserMemoryRepo } from '../../application/ports/user-memory-repo.js';

/**
 * The living user-memory tools (popy.spec §7): the agent reads and rewrites a
 * single document it keeps about the user -- preferences, ongoing projects,
 * how they like to be answered. Write is a full replace, so the model is told
 * to read first and hand back the whole document.
 *
 * Before anything is stored, lines that look like a credential are scrubbed:
 * the user's living memory is not a place for an API key to end up by accident.
 */

type DefineTool = (tool: ToolDefinition) => ToolDefinition;

const MAX_DOC = 8_000;
const SECRET_LINE = /(password|token|secret|api[_-]?key|bearer)\s*[:=]/i;

/** Replaces lines that smell of a credential; exported for the test. */
export function scrubSecrets(text: string): string {
  return text
    .split('\n')
    .map((line) => (SECRET_LINE.test(line) ? '[redacted secret]' : line))
    .join('\n');
}

function text(body: string): { content: [{ type: 'text'; text: string }]; details: undefined } {
  return { content: [{ type: 'text', text: body }], details: undefined };
}

export function buildUserMemoryTools(
  defineTool: DefineTool,
  memory: UserMemoryRepo,
): ToolDefinition[] {
  const read = defineTool({
    name: 'memory_user_read',
    label: 'Read what you know about the user',
    description: 'Reads your living notes about the user (preferences, projects, how they like answers).',
    promptSnippet: 'memory_user_read() — read your living notes on the user',
    parameters: Type.Object({}),
    execute: () => {
      const { doc } = memory.read();
      return Promise.resolve(text(doc.length === 0 ? '(nothing recorded about the user yet)' : doc));
    },
  });

  const update = defineTool({
    name: 'memory_user_update',
    label: 'Update what you know about the user',
    description:
      'Replaces your living notes about the user with the full new markdown. Read first; send the whole document, not a fragment.',
    promptSnippet: 'memory_user_update(content) — rewrite your living notes on the user',
    parameters: Type.Object({
      content: Type.String({ description: 'The full new document' }),
    }),
    execute: (_id, params) => {
      const { content } = params as { content: string };
      const scrubbed = scrubSecrets(content).slice(0, MAX_DOC);
      memory.write(scrubbed);
      return Promise.resolve(text('Updated my notes about you.'));
    },
  });

  return [read, update];
}
