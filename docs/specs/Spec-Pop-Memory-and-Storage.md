# Pop Agent — memory and storage

**Status:** normative
**Legacy coverage:** §§7, 11 and 16
**Primary implementation:** server/src/application/memory, storage/notes/backup adapters
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
## 7. Infinite memory (`application/memory/`)

Hybrid search from day one: FTS5 (lexical) + vector similarity (semantic,
a dot product over `message_embeddings`), fused with RRF (`fuseRankings` in
`domain/memory/rank-fusion.ts`). Three layers, aw's design rewritten:

1. **History search** — agent tools `memory_search(query)` (hits grouped by
   conversation, ≤3 snippets + context), `memory_open(chatId)`,
   `memory_recent()`. A catalog of recent conversations + summaries is
   injected into the system prompt inside untrusted-data delimiters.
2. **Living user document** — one markdown doc of durable facts. The agent
   updates it via tool; ~8k chars cap in prompt; above ~6k an LLM condenses
   (max 1×/day, one-level backup, secret-scrub before persisting).
   Editable in Settings → Memory. Ships EMPTY — no personal seed; Pop Agent is
   a product for anyone to deploy.
3. **Long-chat compaction & restore** (aw's layered design, adapted 01/08 —
   pi ALREADY does the heavy lifting, Pop Agent wraps the policy):
   - **Compaction = pi's native auto-compaction**, explicitly configured via
     `SettingsManager` (before 01/08 it ran on implicit defaults):
     `contextTokens > contextWindow - reserveTokens` (reserve 16384,
     keepRecent 20k) → pi summarizes the old span with iterative context
     (previous summary composes in), cuts at turn boundaries (never inside a
     tool pair), and persists a `CompactionEntry` in the session JSONL.
     Pop Agent builds no summarizer of her own.
   - **Proactive trigger**: pi's own threshold check before each turn.
   - **Reactive trigger = Pop Agent's layer**: pi does NOT retry on a
     context-overflow error (its `retry.*` covers transient failures only).
     The bridge catches an overflow error, calls `session.compact()` and
     retries the SAME turn once — token accounting always errs a little,
     this is the safety net.
   - **Summary authority**: model-generated text never returns with system
     authority. Pi renders its summary as conversation context (verified
     01/08); anything Pop Agent adds herself follows the house pattern — inside
     the untrusted-data envelope, never bare system.
   - **Restore after restart/idle-unload = pi's session resume** (replays
     the JSONL honouring compaction entries), plus Pop Agent's **continuity
     note** (untrusted envelope): real numbers ("the N newest of M stored
     messages"), how to page back (memory_open/memory_search), and the rule
     that kills a class of hallucination — "tool results from before the
     restart may not have survived: re-run the tool instead of answering
     from memory".
   - **Memory humility**: the prompt states "never claim you have no memory
     before searching" — matching the existing memory/files tools.
4. **Files awareness** (designed in 1.28, built in 1.29) — the agent must
   know *that* a file exists without being handed it. Two halves, same
   progressive-disclosure move as pinned skills and the recent-chats
   catalog — presence is cheap, content is on demand:
   - **Catalog**: a compact list of Files (names + folders, most recent N,
     inside untrusted-data delimiters — filenames are user data) joins the
     session instructions; the bridge already reopens a session when that
     string changes. Names only for now; per-file descriptions wait for a
     real case that needs them.
   - **Instinct**: know-thyself gains the rule — an unrecognized name,
     project or term means `files_search` + `memory_search` *before* the
     web and before answering "I don't know".
   Content still enters context only by attachment, @-mention, or the
   agent's own tools. Explicitly **no per-turn RAG injection** of file
   chunks: an agent with a real filesystem fetches; it is not fed.
   Motivated by the OffSchool dialogue (2026-07-31): the answer sat in a
   filename the agent had no way to see (`pop skills: none` in the log),
   and it went to the web instead of its own files_search.

## 11. Notes (`infrastructure/notes/`)

Pop Agent owns its notes: a vault of plain markdown files at
`POP_AGENT_DATA_DIR/notes/`, created and maintained by the agent. No external
vault integration — Obsidian-compatible by being plain .md; users may
sync/open it externally.

- Agent tools: `notes_list`, `notes_read` (size cap), `notes_search`
  (snippets + file-count guard), `notes_write`, `notes_append`.
- **`notes_append` is a real operation, not sugar over write.** `read` is
  capped, so read-glue-write on a note past the cap saves the truncated
  copy and deletes the rest; append writes straight to the end and cannot
  lose what it never read. It creates the note when absent, and inserts a
  newline first when the note does not end in one, so an added heading can
  never land on the end of the previous paragraph.
- Path jail, ported line-by-line as a concept from aw: resolve real path
  (symlinks) against the notes root, reject `..` and absolute escapes.

## 16. Backup and restore

- Automatic snapshots: tar.gz of `POP_AGENT_DATA_DIR` (minus `secret.key`,
  minus `backups/` itself), consistent SQLite copy via the backup API
  (never a raw copy of a hot WAL db). Retention: daily × 7 + weekly × 4
  (tunable). Settings → Backup lists snapshots for download.
- **Restore only with the server stopped**: `pop restore <file>`. Never
  over a running server. Restore UI: maybe later.
