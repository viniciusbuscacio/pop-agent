import { fuseRankings, topKByCosine } from '../../domain/memory/rank-fusion.js';
import type { Embedder } from '../ports/embedder.js';
import type { EmbeddingsRepo } from '../ports/embeddings-repo.js';
import type { MemoryChatHit, MemoryMessageRow, MemoryRepo } from '../ports/memory-repo.js';

/**
 * Memory search that is lexical and semantic at once (pop-agent.spec §7). FTS5 finds
 * the messages that share words with the query; the embedder finds the ones
 * that share meaning even when they share no words ("what did we decide about
 * the trip" reaching a message that only said "flights to Recife"). The two
 * rankings are fused with reciprocal-rank fusion, then grouped by chat.
 *
 * With no embedder -- or before a message has been embedded -- it degrades to
 * pure FTS5, so search always works; the semantic half only adds recall.
 */

const CANDIDATES = 40;
const MAX_SNIPPETS_PER_CHAT = 3;
const DEFAULT_CHAT_LIMIT = 8;

export interface HybridMemoryDeps {
  memory: MemoryRepo;
  embeddings?: EmbeddingsRepo;
  embedder?: Embedder;
}

export class HybridMemory {
  constructor(private readonly deps: HybridMemoryDeps) {}

  async search(query: string, options: { limit?: number } = {}): Promise<MemoryChatHit[]> {
    const lexical = this.deps.memory.searchRows(query, CANDIDATES);
    const semantic = await this.semanticRows(query);

    // Nothing semantic (no embedder, or no vectors yet): plain FTS grouping.
    const rows =
      semantic.length === 0
        ? lexical
        : fuseRankings([lexical, semantic], (row) => String(row.rowid), { limit: CANDIDATES }).map(
            (fused) => fused.item,
          );

    return groupByChat(rows, options.limit ?? DEFAULT_CHAT_LIMIT);
  }

  private async semanticRows(query: string): Promise<MemoryMessageRow[]> {
    const { embedder, embeddings } = this.deps;
    if (embedder === undefined || embeddings === undefined) return [];

    const stored = embeddings.all();
    if (stored.length === 0) return [];

    const [queryVector] = await embedder.embed([query], 'query');
    if (queryVector === undefined) return [];

    const ranked = topKByCosine(
      queryVector,
      stored.map((entry) => ({ key: String(entry.messageRowid), vector: entry.vector })),
      CANDIDATES,
    );
    const rowids = ranked.map((entry) => Number(entry.key));

    // Fetch the rows, then restore the cosine ranking (the IN query does not order).
    const byRowid = new Map(this.deps.memory.rowsByRowid(rowids).map((row) => [row.rowid, row]));
    return rowids
      .map((rowid) => byRowid.get(rowid))
      .filter((row): row is MemoryMessageRow => row !== undefined);
  }
}

function groupByChat(rows: MemoryMessageRow[], limit: number): MemoryChatHit[] {
  const byChat = new Map<string, MemoryChatHit>();
  for (const row of rows) {
    let hit = byChat.get(row.chatId);
    if (hit === undefined) {
      if (byChat.size >= limit) continue;
      hit = { chatId: row.chatId, title: row.title, snippets: [] };
      byChat.set(row.chatId, hit);
    }
    if (hit.snippets.length < MAX_SNIPPETS_PER_CHAT) {
      hit.snippets.push({ text: row.snippet, role: row.role, createdAt: row.createdAt });
    }
  }
  return [...byChat.values()];
}
