import type { ModelInfo } from '../../application/ports/agent-bridge.js';
import {
  ProviderGatewayError,
  type CompletionRequest,
  type ProviderGateway,
} from '../../application/ports/provider-gateway.js';

/**
 * Anthropic over plain HTTP (pop-agent.spec §15). The one vendor quirk phase 1
 * carries: a different auth header, a version header, and a different
 * catalog/completion shape. A point `if` in the wiring picks this gateway;
 * nothing else in the app knows the difference.
 */

const BASE_URL = 'https://api.anthropic.com';
const TIMEOUT_MS = 20_000;
const VERSION = '2023-06-01';

interface CatalogRow {
  id?: string;
  display_name?: string;
}

export class AnthropicGateway implements ProviderGateway {
  constructor(private readonly baseUrl: string = BASE_URL) {}

  async listModels(apiKey: string | undefined): Promise<ModelInfo[]> {
    if (apiKey === undefined) {
      throw new ProviderGatewayError('Anthropic only lists models for a key.');
    }
    const response = await fetch(`${this.baseUrl}/v1/models`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': VERSION },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new ProviderGatewayError(await errorText(response));
    }

    const body = (await response.json()) as { data?: CatalogRow[] };
    return (body.data ?? [])
      .filter((row): row is CatalogRow & { id: string } => typeof row.id === 'string')
      .map((row) => ({
        id: row.id,
        ...(row.display_name === undefined ? {} : { name: row.display_name }),
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async complete(request: CompletionRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': request.apiKey,
        'anthropic-version': VERSION,
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
      content?: { type?: string; text?: string }[];
    };
    const text = body.content?.find((part) => part.type === 'text')?.text;
    if (typeof text !== 'string') {
      throw new ProviderGatewayError('The provider answered without a message.', {
        reachable: true,
      });
    }
    return text;
  }
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
