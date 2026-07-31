import type { ArtifactService } from './artifact-service.js';
import type { ArtifactChunksRepo } from '../ports/artifact-chunks-repo.js';
import type { Embedder } from '../ports/embedder.js';

/**
 * The semantic index over Files (popy.spec §7/§14, decision of 31/07): text
 * out of every file, chunked and embedded, so the agent can learn from what
 * the user keeps. Indexing is never on the path of a request -- a stored file
 * hands its id here and moves on; a boot backfill catches the rest. Search is
 * the same brute-force cosine the message memory uses.
 */

const CHUNK_CHARS = 1200;
const MAX_CHUNKS_PER_FILE = 200;
const TEXTUAL = /^(text\/|application\/(json|xml|x-yaml|yaml|javascript|typescript))/;

/** The application's own port for text extraction; infrastructure implements it. */
export interface TextExtractor {
  extract(bytes: Buffer, mime: string, name: string): Promise<string | undefined>;
}

export interface FileSearchHit {
  artifactId: string;
  name: string;
  snippet: string;
  score: number;
}

export interface FileIndexerDeps {
  artifacts: ArtifactService;
  chunks: ArtifactChunksRepo;
  embedder: Embedder;
  extractor: TextExtractor;
  onError?: (message: string) => void;
}

export class FileIndexer {
  private working = false;

  constructor(private readonly deps: FileIndexerDeps) {}

  /** Extracts, chunks and embeds one file. Fire-and-forget from the caller. */
  async index(artifactId: string): Promise<void> {
    try {
      const found = this.deps.artifacts.read(artifactId);
      if (found === undefined) return;
      const text = await this.textOf(found.bytes, found.artifact.mime, found.artifact.name);
      if (text === undefined || text.trim().length === 0) {
        this.deps.chunks.replaceFor(artifactId, []);
        return;
      }
      const pieces = chunk(text).slice(0, MAX_CHUNKS_PER_FILE);
      const vectors = await this.deps.embedder.embed(pieces, 'passage');
      this.deps.chunks.replaceFor(
        artifactId,
        pieces.flatMap((piece, i) => {
          const vector = vectors[i];
          return vector === undefined ? [] : [{ text: piece, vector }];
        }),
      );
    } catch (error) {
      this.deps.onError?.(error instanceof Error ? error.message : 'file indexing failed');
    }
  }

  /** Indexes every file that has no chunks yet. Safe to call on boot. */
  async backfill(): Promise<void> {
    if (this.working) return;
    this.working = true;
    try {
      const indexed = this.deps.chunks.indexedArtifactIds();
      for (const artifact of this.deps.artifacts.listAll()) {
        if (!indexed.has(artifact.id)) await this.index(artifact.id);
      }
    } finally {
      this.working = false;
    }
  }

  /** Top-k chunks across every file, by cosine to the query. */
  async search(query: string, k = 6): Promise<FileSearchHit[]> {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const [vector] = await this.deps.embedder.embed([trimmed], 'query');
    if (vector === undefined) return [];

    const names = new Map(this.deps.artifacts.listAll().map((a) => [a.id, a.name]));
    return this.deps.chunks
      .all()
      .map((entry) => ({
        artifactId: entry.artifactId,
        name: names.get(entry.artifactId) ?? entry.artifactId,
        snippet: entry.text,
        score: dot(vector, entry.vector),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  private async textOf(bytes: Buffer, mime: string, name: string): Promise<string | undefined> {
    if (TEXTUAL.test(mime)) return bytes.toString('utf8');
    return this.deps.extractor.extract(bytes, mime, name);
  }
}

/** Paragraph-friendly chunks: split on blank lines, packed up to the budget. */
export function chunk(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  const out: string[] = [];
  let current = '';
  for (const paragraph of paragraphs) {
    const piece = paragraph.trim();
    if (piece.length === 0) continue;
    if (current.length + piece.length + 2 > CHUNK_CHARS && current.length > 0) {
      out.push(current);
      current = '';
    }
    if (piece.length > CHUNK_CHARS) {
      for (let i = 0; i < piece.length; i += CHUNK_CHARS) out.push(piece.slice(i, i + CHUNK_CHARS));
      continue;
    }
    current = current.length === 0 ? piece : `${current}\n\n${piece}`;
  }
  if (current.length > 0) out.push(current);
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  const length = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i++) sum += (a[i] ?? 0) * (b[i] ?? 0);
  return sum;
}
