import { Type } from 'typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { envelope, sanitize } from '../../domain/safety/sanitize.js';
import { WebFetchError, webFetch, type WebFetchDeps } from './web-fetch.js';

/**
 * The web_fetch tool (docs/specs/Spec-Pop-General.md §12). One page in, its readable text out,
 * always wrapped in the safety envelope with the URL as the source -- a web
 * page is the least trusted content there is, and the model must read it as
 * data. SSRF and the caps live in {@link webFetch}.
 */

type DefineTool = (tool: ToolDefinition) => ToolDefinition;

export function buildWebTools(defineTool: DefineTool, deps: WebFetchDeps = {}): ToolDefinition[] {
  const fetchTool = defineTool({
    name: 'web_fetch',
    label: 'Fetch a web page',
    description:
      'Fetches a public http(s) URL and returns its readable text. Private and loopback addresses are refused.',
    promptSnippet: 'web_fetch(url) — read a public web page',
    parameters: Type.Object({ url: Type.String({ description: 'An http(s) URL' }) }),
    execute: async (_id, params) => {
      const { url } = params as { url: string };
      try {
        const result = await webFetch(url, deps);
        const header = result.title === undefined ? url : `${result.title}\n${url}`;
        const body = envelope(sanitize(`${header}\n\n${result.text}`).clean, `web:${result.url}`);
        return { content: [{ type: 'text', text: body }], details: undefined };
      } catch (error) {
        const message =
          error instanceof WebFetchError
            ? error.message
            : error instanceof Error
              ? error.message
              : 'The page could not be fetched.';
        return { content: [{ type: 'text', text: message }], details: undefined, isError: true };
      }
    },
  });

  return [fetchTool];
}
