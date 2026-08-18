import type { ModelInfo } from '../ports/agent-bridge.js';
import type { ProviderGateway } from '../ports/provider-gateway.js';
import type { ProviderDefinition } from './provider-definitions.js';

export type ModelCatalogSource = 'live' | 'cache' | 'engine' | 'static';

export interface CatalogCache {
  fetchedAt: number;
  models: ModelInfo[];
}

interface CatalogRequest {
  definition: ProviderDefinition;
  gateway: ProviderGateway | undefined;
  apiKey: string | undefined;
  now: () => number;
  readCache: () => CatalogCache | undefined;
  writeCache: (cache: CatalogCache) => void;
  engineModels: (providerId: string) => Promise<ModelInfo[]>;
}

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/** Resolves a model catalog from live, cached, engine, then static sources. */
export async function resolveProviderCatalog(
  request: CatalogRequest,
): Promise<{ models: ModelInfo[]; source: ModelCatalogSource }> {
  const { definition, gateway, apiKey } = request;
  if (apiKey !== undefined && gateway !== undefined) {
    const cached = request.readCache();
    if (
      cached !== undefined && cached.models.length > 0 &&
      request.now() - cached.fetchedAt < CATALOG_TTL_MS
    ) return { models: cached.models, source: 'cache' };

    try {
      const models = await gateway.listModels(apiKey);
      if (models.length > 0) {
        request.writeCache({ fetchedAt: request.now(), models });
        return { models, source: 'live' };
      }
    } catch {
      if (cached !== undefined && cached.models.length > 0) {
        return { models: cached.models, source: 'cache' };
      }
    }
  }

  try {
    const models = await request.engineModels(definition.id);
    if (models.length > 0) return { models, source: 'engine' };
  } catch {
    // Static definitions keep catalog rendering available when the engine fails.
  }
  return { models: [...definition.staticModels], source: 'static' };
}
