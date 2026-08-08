import type { ModelInfo } from '../../application/ports/agent-bridge.js';
import {
  ProviderGatewayError,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderGateway,
} from '../../application/ports/provider-gateway.js';

/**
 * Any OpenAI-compatible HTTP API (pop-agent.spec §15): the model catalog and the
 * one-shot completions that do not belong to a conversation -- the key test,
 * titles and summaries. OpenRouter, OpenAI and user-run endpoints all speak
 * this shape; chat traffic goes through pi, never through here.
 */

const TIMEOUT_MS = 20_000;

/**
 * OpenRouter's attribution headers (aw sends its own pair): they name the app
 * in the provider's dashboard and rankings, and cost nothing.
 */
const OPENROUTER_ATTRIBUTION = {
  'HTTP-Referer': 'https://github.com/viniciusbuscacio/pop-agent',
  'X-Title': 'Pop Agent',
};

/** What an OpenAI-shaped `GET /models` answers, for the fields Pop Agent keeps. */
interface CatalogRow {
  id?: string;
  name?: string;
  context_length?: number;
  /** US dollars per single token, as decimal strings (OpenRouter only). */
  pricing?: { prompt?: string; completion?: string };
}

export class OpenAiCompatibleGateway implements ProviderGateway {
  /**
   * @param baseUrl static, or read late so the custom provider's URL can
   *   change in Settings without a restart.
   */
  constructor(
    private readonly baseUrl: string | (() => string),
    private readonly extraHeaders: Record<string, string> = {},
  ) {}

  async listModels(apiKey: string | undefined): Promise<ModelInfo[]> {
    const headers: Record<string, string> = { ...this.extraHeaders };
    if (apiKey !== undefined) headers['authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(`${this.url()}/models`, {
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

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const response = await fetch(`${this.url()}/chat/completions`, {
      method: 'POST',
      headers: {
        ...this.extraHeaders,
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
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_cost?: number; cost?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new ProviderGatewayError('The provider answered without a message.', {
        reachable: true,
      });
    }
    const inputTokens = body.usage?.prompt_tokens;
    const outputTokens = body.usage?.completion_tokens;
    const reportedCost = body.usage?.total_cost ?? body.usage?.cost;
    return {
      text: content,
      ...(inputTokens === undefined || outputTokens === undefined
        ? {}
        : {
            usage: {
              provider: 'openai-compatible',
              model: request.model,
              inputTokens,
              outputTokens,
              cost: typeof reportedCost === 'number' ? reportedCost : 0,
            },
          }),
    };
  }

  private url(): string {
    const url = typeof this.baseUrl === 'function' ? this.baseUrl() : this.baseUrl;
    if (url.length === 0) {
      throw new ProviderGatewayError('This provider has no URL configured yet (Settings).');
    }
    return url.replace(/\/$/, '');
  }
}

/** The default provider, with its attribution headers (pop-agent.spec §15). */
export function createOpenRouterGateway(): OpenAiCompatibleGateway {
  return new OpenAiCompatibleGateway(
    'https://openrouter.ai/api/v1',
    OPENROUTER_ATTRIBUTION,
  );
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

/** OpenRouter prices a single token; Pop Agent displays a million of them. */
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
