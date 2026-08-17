import type { Embedder, EmbeddingKind } from '../../application/ports/embedder.js';

/**
 * Local embeddings with transformers.js (docs/specs/Spec-Pop-General.md §7): the multilingual
 * e5-small model, run on the server's CPU. The model (~110 MB) downloads once
 * into POP_AGENT_DATA_DIR/models and is cached; the whole library is imported
 * dynamically so an install running the fake bridge -- CI, the smoke -- never
 * loads it.
 *
 * e5 was trained with instruction prefixes: a search string is a `query:` and a
 * stored document is a `passage:`. Skipping them measurably hurts recall, so
 * the adapter always applies them.
 */

const MODEL_ID = 'Xenova/multilingual-e5-small';
export const EMBEDDING_DIMENSION = 384;

export interface TransformersEmbedderOptions {
  /** Where the model files are cached; POP_AGENT_DATA_DIR/models. */
  cacheDir: string;
}

export class TransformersEmbedder implements Embedder {
  readonly dimension = EMBEDDING_DIMENSION;
  private extractor: Promise<FeatureExtractor> | undefined;

  constructor(private readonly options: TransformersEmbedderOptions) {}

  async embed(texts: string[], kind: EmbeddingKind): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extractor = await this.load();
    const prefixed = texts.map((text) => `${kind}: ${text}`);
    const output = await extractor(prefixed, { pooling: 'mean', normalize: true });
    const rows = output.tolist() as number[][];
    return rows.map((row) => Float32Array.from(row));
  }

  private load(): Promise<FeatureExtractor> {
    this.extractor ??= this.create();
    return this.extractor;
  }

  private async create(): Promise<FeatureExtractor> {
    const transformers = (await import('@huggingface/transformers')) as unknown as TransformersModule;
    transformers.env.cacheDir = this.options.cacheDir;
    // Deterministic, offline after the first fetch: no telemetry, our cache.
    transformers.env.allowRemoteModels = true;
    const pipe = await transformers.pipeline('feature-extraction', MODEL_ID);
    return pipe as unknown as FeatureExtractor;
  }
}

/** The slice of the transformers.js surface this adapter uses. */
interface TransformersModule {
  env: { cacheDir: string; allowRemoteModels: boolean };
  pipeline: (task: string, model: string) => Promise<unknown>;
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;
