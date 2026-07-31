import type { ModelInfo } from '../../application/ports/agent-bridge.js';
import {
  ProviderGatewayError,
  type CompletionRequest,
  type ProviderGateway,
} from '../../application/ports/provider-gateway.js';

/**
 * OpenRouter over plain HTTP (popy.spec §15). Two endpoints and nothing else:
 * the catalog, and the one-shot completions that do not belong to a
 * conversation. Chat traffic goes through pi, never through here.
 */

const BASE_URL = 'https://openrouter.ai/api/v1';
const TIMEOUT_MS = 20_000;

/**
 * OpenRouter's attribution headers (aw sends its own pair): they name the app
 * in the provider's dashboard and rankings, and cost nothing.
 */
const ATTRIBUTION = {
  'HTTP-Referer': 'https://github.com/viniciusbuscacio/popy',
  'X-Title': 'Popy',
};

/** What OpenRouter's `GET /models` answers, for the fields Popy keeps. */
interface CatalogRow {
  id?: string;
  name?: string;
  context_length?: number;
  /** US dollars per single token, as decimal strings. */
  pricing?: { prompt?: string; completion?: string };
}

export class OpenRouterGateway implements ProviderGateway {
  constructor(private readonly baseUrl: string = BASE_URL) {}

  async listModels(apiKey: string | undefined): Promise<ModelInfo[]> {
    const headers: Record<string, string> = { ...ATTRIBUTION };
    if (apiKey !== undefined) headers['authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${this.baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ProviderGatewayError(await errorText(response));
    }

    const body = (await response.json()) as { data?: CatalogRow[] };
    return (body.data ?? [])
      .filter((row): row is CatalogRow & { id: string } => typeof row.id === 'string')
      .map(toModelInfo)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async complete(request: CompletionRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        ...ATTRIBUTION,
        'content-type': 'application/json',
        authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: request.maxTokens,
        messages: [{ role: 'user', content: request.prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ProviderGatewayError(await errorText(response));
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ProviderGatewayError('The provider answered without a message.');
    }
    return content;
  }

}

function toModelInfo(row: CatalogRow & { id: string }): ModelInfo {
  const input = perMillion(row.pricing?.prompt);
  const output = perMillion(row.pricing?.completion);
  return {
    id: row.id,
    ...(row.name === undefined ? {} : { name: row.name }),
    ...(row.context_length === undefined ? {} : { context: row.context_length }),
    ...(input === undefined || output === undefined ? {} : { pricing: { input, output } }),
  };
}

/** OpenRouter prices a single token; Popy displays a million of them. */
function perMillion(perToken: string | undefined): number | undefined {
  if (perToken === undefined) return undefined;
  const value = Number(perToken);
  return Number.isFinite(value) ? value * 1_000_000 : undefined;
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (typeof body.error?.message === 'string') return body.error.message;
  } catch {
    // Not JSON; the status line will have to do.
  }
  return `The provider answered ${String(response.status)}.`;
}
