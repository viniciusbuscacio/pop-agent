import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { MemoryRepo } from '../../application/ports/memory-repo.js';
import { envelope, sanitize } from '../../domain/safety/sanitize.js';

/**
 * Memory tools (popy.spec §7): the agent reaching back across every past
 * conversation. Search is grouped by chat; open pulls a transcript; recent
 * lists what happened lately. Everything returned is old message text -- which
 * may itself contain something pasted from outside -- so it goes through
 * sanitize + envelope before the model reads it.
 */

type DefineTool = (tool: ToolDefinition) => ToolDefinition;

const TRANSCRIPT_LINES = 60;

function data(body: string, source: string): {
  content: [{ type: 'text'; text: string }];
  details: undefined;
} {
  return { content: [{ type: 'text', text: envelope(sanitize(body).clean, source) }], details: undefined };
}

export function buildMemoryTools(defineTool: DefineTool, memory: MemoryRepo): ToolDefinition[] {
  const search = defineTool({
    name: 'memory_search',
    label: 'Search past conversations',
    description:
      'Searches every past conversation for a phrase and returns the chats that mentioned it, with excerpts and their chat ids.',
    promptSnippet: 'memory_search(query) — search all past chats',
    parameters: Type.Object({ query: Type.String({ description: 'What to look for' }) }),
    execute: (_id, params) => {
      const { query } = params as { query: string };
      const hits = memory.search(query);
      if (hits.length === 0) {
        return Promise.resolve({
          content: [{ type: 'text' as const, text: '(nothing found in past conversations)' }],
          details: undefined,
        });
      }
      const body = hits
        .map((hit) => {
          const lines = hit.snippets.map((snippet) => `  - ${snippet.text}`).join('\n');
          return `# ${hit.title} (chatId: ${hit.chatId})\n${lines}`;
        })
        .join('\n\n');
      return Promise.resolve(data(body, 'memory:search'));
    },
  });

  const open = defineTool({
    name: 'memory_open',
    label: 'Open a past conversation',
    description: 'Reads the transcript of a past conversation by its chat id (from memory_search).',
    promptSnippet: 'memory_open(chatId) — read a past conversation',
    parameters: Type.Object({ chatId: Type.String({ description: 'A chat id, e.g. chat-abc123' }) }),
    execute: (_id, params) => {
      const { chatId } = params as { chatId: string };
      const lines = memory.transcript(chatId, TRANSCRIPT_LINES);
      if (lines.length === 0) {
        return Promise.resolve({
          content: [{ type: 'text' as const, text: '(no such conversation, or it is empty)' }],
          details: undefined,
        });
      }
      const body = lines.map((line) => `${line.role}: ${line.content}`).join('\n\n');
      return Promise.resolve(data(body, `memory:${chatId}`));
    },
  });

  const recent = defineTool({
    name: 'memory_recent',
    label: 'Recent conversations',
    description: 'Lists your most recent conversations with their summaries.',
    promptSnippet: 'memory_recent() — list recent conversations',
    parameters: Type.Object({}),
    execute: () => {
      const chats = memory.recentChats(15);
      if (chats.length === 0) {
        return Promise.resolve({
          content: [{ type: 'text' as const, text: '(no conversations yet)' }],
          details: undefined,
        });
      }
      const body = chats
        .map((chat) => {
          const summary = chat.summary.length > 0 ? ` — ${chat.summary}` : '';
          return `- ${chat.title} (chatId: ${chat.chatId})${summary}`;
        })
        .join('\n');
      return Promise.resolve(data(body, 'memory:recent'));
    },
  });

  return [search, open, recent];
}
