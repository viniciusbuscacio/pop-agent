# pop-agent.spec — the project specification

Version 1.87 — 2026-08-12.
This file is the single source of truth for Pop Agent. AGENTS.md (and CLAUDE.md,
which imports it) directs here. When a working session produces a new rule or
decision, it lands in this file. History and the "why" live in the
maintainer's notes outside the repo; this file records only the current
normative state.

> Inspired by go-apps.spec, but Pop Agent is NOT part of the go-apps family —
> this spec is independent.

## 1. What Pop Agent is

- A self-hosted personal agent platform: clone from GitHub, deploy on a
  VPS, and your personal agent is live — reachable from any browser as a
  PWA (desktop and mobile).
- **Single user per installation.** A second person runs a second instance
  on another port. This is a permanent design constraint, not a v1 shortcut.
- The engine is the **pi agent** (https://pi.dev), embedded in-process via
  its TypeScript SDK. Pop Agent is the product around it: auth, chats, memory,
  notes, skills, costs, backup, PWA.
- License MIT. Repo private until the maintainer opens it. Repo is 100%
  English — code, comments, tests, docs, UI strings, commits. npm package
  name, if ever published: `pop-agent` (free on npm at the time of the rename;
  the old `popy` was squatted).
- **Zero telemetry, no phone-home** — declared in the README. The only
  outbound traffic: LLM/provider calls and the opt-in update check.

## 2. Stack

- **Backend**: Node.js 22 LTS, TypeScript strict, pure ESM. HTTP: Hono
  (fallback candidate: Fastify — decide at skeleton time; nothing else
  depends on it). Validation: Zod at the borders. Logs: pino (JSON in
  prod, pretty in dev; never log message content in prod).
- **Database**: SQLite via `better-sqlite3`, WAL mode, FTS5 in the same
  file. Vectors are ordinary `BLOB` columns holding a `Float32Array`;
  similarity is a dot product in JS over the loaded set. **`sqlite-vec` is
  not a dependency and never was** — earlier versions of this spec promised
  it, the plan-B authorized on 31/07 is what got built, and this line is the
  correction (1.60). A single-user server has thousands of rows, not
  millions, and brute force over them is milliseconds; adopting the
  extension now would add a native dependency and a *second* vector search
  beside the working one. Embeddings computed locally in-process:
  `multilingual-e5-small` via transformers.js (ONNX, CPU, PT/EN).
- **Frontend**: React 19 + TypeScript strict, Vite, Tailwind CSS v4 over
  own CSS-var design tokens, react-router, Zustand (or
  `useSyncExternalStore` stores). PWA via vite-plugin-pwa.
- **Tests**: Vitest (+ Testing Library + happy-dom on web). Lint: ESLint 9
  flat config. **Gate**: `npm run gate` = lint + typecheck + tests + build.
  Nothing commits without a green gate.
- **CI**: GitHub Actions runs gate + smoke (fake provider, zero tokens) on
  every push to main, from the first skeleton commit.

## 3. Repo layout (monorepo, npm workspaces)

```
pop-agent/
├── pop-agent.spec              # this file — source of truth
├── AGENTS.md              # pointer here + repo specifics
├── CLAUDE.md              # "@AGENTS.md"
├── package.json           # workspaces: shared, server, web
├── shared/src/            # THE DTO LAYER — wire contract, pure types
├── server/src/
│   ├── domain/            # entities, value objects, domain errors, pure
│   │   │                  #   services (e.g. safety §10) — innermost layer
│   ├── application/       # use cases + ports/ (interfaces implemented by
│   │   │                  #   outer layers): chat, memory §7, skills §8,
│   │   │                  #   auth §9
│   ├── infrastructure/    # adapters with IO implementing the ports
│   │   ├── db/            #   SQLite + migrations + FTS5 + vec
│   │   ├── agent/         #   pi SDK bridge (§5)
│   │   ├── notes/         #   Pop Agent's own notes vault (§11)
│   │   ├── web/           #   web_fetch for the agent (§12)
│   │   ├── backup/        #   snapshots (§16)
│   │   └── update/        #   pi auto-update (§15)
│   ├── interface/         # delivery: HTTP routes, SSE, control plane, CLI
│   │   │                  #   §17 — Zod validation, DTO ↔ domain mapping
│   ├── architecture/      # boundary test (see below)
│   └── main.ts            # composition root — the only place that wires
│                          #   layers together
└── web/                   # React PWA (§13–14)
```

**The backend is 100% clean architecture** (aw's `internal/` layout ported:
domain / application / dto / infrastructure / appcore → interface+main):

- **Dependency rule**, enforced by `server/src/architecture/boundary.test.ts`
  (runs in the gate; aw's `boundary_test.go` ported): `domain` imports
  nothing; `application` imports only `domain`; `infrastructure` imports
  `application` + `domain`; `interface` imports `application` + `domain` +
  `shared`; `main.ts` wires everything. Any other cross-layer import fails
  the gate.
- **Inner layers are pure** (aw's second test): `domain`, `application` and
  `shared` may use Node built-ins but NEVER third-party packages.
  Exceptions only via an explicit allowlist in the boundary test, each with
  a TODO — the aw shrinking-allowlist spirit.
- **DTOs standardize everything that crosses the boundary**: `shared/` is
  the DTO layer — plain types, zero dependencies (`StreamEvent`,
  `ApiError`, request/response shapes). Domain objects never leave the
  application layer; the interface layer validates inbound payloads with
  Zod and maps use-case results to DTOs explicitly. Being a workspace
  package, the same DTOs are consumed by `web/` — the frontend needs no
  architecture of its own, just the wire contract.
- Persistence is behind ports defined in `application/ports/`
  (`ChatRepo`, `MemoryRepo`, `SkillRepo`…). SQLite is an adapter. A future
  multi-user Postgres port = new adapter, not a rewrite. No ORM as an
  abstraction bet; optionally Drizzle as a typed query builder inside the
  adapter. FTS5/vec queries are raw SQL in the adapter, by design.

## 4. Runtime data (`POP_AGENT_DATA_DIR`, default `~/.pop-agent/`)

```
~/.pop-agent/
├── pop-agent.db          # SQLite: product data (§6)
├── secret.key       # 0600 — encrypts stored provider secrets; NEVER in backups
├── sessions/        # pi's JSONL session files (pi-owned, never parsed by Pop Agent)
├── attachments/     # uploaded files (metadata in DB)
├── files/           # the user's Files: a plain folder tree, real names (§14)
├── notes/           # Pop Agent's own markdown notes vault (§11)
├── skills/          # user-added skills (§8)
└── backups/         # tar.gz snapshots (§16)
```

- `.env`: `OPENROUTER_API_KEY` optional seed, `POP_AGENT_PORT` (default 8787),
  `POP_AGENT_BIND` (default `127.0.0.1`), `POP_AGENT_DATA_DIR`, `POP_AGENT_WORKSPACE`,
  `POP_AGENT_ENGINE` (`fake` | `pi`; `fake` is the scripted bridge used to build and
  test the chat without spending tokens).
  The session HMAC secret is **not** an environment variable: it is
  generated at setup and kept in the encrypted `secrets` table (§9), so a
  leaked backup -- which excludes `secret.key` -- cannot forge a token.
- `POP_AGENT_WORKSPACE` (default `~/pop-agent-workspace/`): the single root directory
  where the agent works; remote-coding repos are cloned as subfolders.

## 5. pi integration (`infrastructure/agent/`)

> End-to-end flow detail (frontend ↔ pi through every layer, event
> mapping, failure modes): `docs/agent-flow.md`.

- Package `@earendil-works/pi-coding-agent`, embedded via SDK
  (`createAgentSession`). Plan B if crash isolation ever demands it: pi as
  an RPC subprocess — the `AgentBridge` interface covers both without
  touching the rest.
- **Who stores what**: pi persists sessions as JSONL trees (branching,
  compaction, model changes) — that is the *execution state*, the exact
  context the model sees. Pop Agent never parses those files. Pop Agent's SQLite is
  the *product state*: chat list, titles, rendered messages, search,
  memory. Messages exist in both places on purpose — a pi format change
  must never touch the UI or memory.
- pi's `sessionDir` points into `POP_AGENT_DATA_DIR/sessions/`
  (`SessionManager.create(cwd, sessionDir)`). Resume =
  `SessionManager.open(path)` with the path stored in
  `chats.pi_session_id`. Smoke tests use `SessionManager.inMemory()`.
- **Tools**: read, bash, edit, write — all enabled, full power ("yolo
  mode"). No permission prompts. The only gate is the taint rule (§10).
  Pop Agent's own capabilities (memory, notes, web, skills) are registered as pi
  custom tools via `defineTool` (typebox schemas).
- **Concurrency**: multiple chats run in parallel. Cap configurable,
  default 20; excess queues with visible status.
  **One run per chat** on top of that ceiling — a second message to a busy
  chat is refused with `run_in_progress`, and the frontend holds it in a
  one-slot client-side queue that fires when the chat frees. Overflow past
  the global ceiling is queued rather than refused, so a burst of chats
  degrades into waiting.
- **Stopping a queued run** removes it from the queue instead of aborting an
  engine it never reached, and still reports `aborted`: a client that asked
  to stop needs to stop waiting. Idle sessions unload from
  RAM after ~3h; reopening is transparent (ms). A warm-standby pool (+1
  pre-created session) was evaluated and rejected for now — session
  creation is an in-process object (ms); revisit only if skill/extension
  scanning ever makes it slow.
- **Stop is a kill**: stopping a run must kill the process group of any
  running bash child, not just abort the stream. aw has a working
  implementation to consult; verify what pi does on abort while coding.
- **Tool output streams in real time** to the UI (terminal-style), from
  v0.1.
- Model switchable per chat and mid-session; global default in Settings.

## 6. Database (SQLite)

Single file `pop-agent.db`. Migrations numbered, run at boot.

```sql
chats(id, title, model, archived, pi_session_id, summary, auto_title,
      created_at, updated_at)
messages(id, chat_id, role, content, thinking, tools_json,
         attachments_json, created_at)
messages_fts      -- FTS5 external-content table over messages.content
message_embeddings(message_rowid, vector)       -- Float32Array BLOB, §7
chat_titles(chat_id, title, turn, source, created_at)  -- append-only, §14
user_memory(doc, backup, last_condensed_at)     -- single-row living doc
settings(key, value)                            -- JSON per key
secrets(key, value_encrypted)                   -- §9, secret.key encrypted
llm_runs(id, chat_id, provider, model, tokens_in, tokens_out,
         cost, created_at)                      -- cost accounting (§14)
skill_embeddings(slug, signature, vector)       -- router vectors, §8
skill_usage(slug, use_count, last_used_at)      -- what earns its slot, §8
file_provenance(id, chat_id, path, created_at)  -- append-only log, §14
```

- **IDs and internal file names** — two shapes, one CSPRNG generator (11 base62
  chars ≈ 65 bits, drawn by rejection sampling so there is no modulo bias):
  - **Entity id** = `prefix-<11 base62>` with a full-word prefix and a hyphen:
    `chat-Hq8Lm2XcN5R`, `message-…`, `run-…`, `file-…`. Nothing about the
    install leaks through an id. On a primary-key collision (astronomically
    unlikely, but defined) the repo re-draws the id and retries once — it never
    fails the request or overwrites.
  - **Internal file** = `prefix_<11 base62>.ext` with an underscore, for files
    Pop Agent makes itself (`audio_2f9FmGo58Jm.wav`, `text_…`). Created with an
    exclusive flag; on `EEXIST` it re-draws. The user's own files (attachments,
    notes) keep their names — the convention is for Pop Agent's internal artifacts.
- `messages.tools_json` holds **one record per tool call**, not per event: a
  call that starts, streams six lines and exits is one thing that happened.
  The frontend folds the live stream the same way, so a conversation reads
  identically while it streams and after a reload. Details accumulate in
  order (command, output, closing note).
- Message order is `(created_at, rowid)`. Ties are broken by insertion order
  because a question and a fast answer land in the same millisecond, and
  random ids cannot order them.
- Attachments travel and rest as data URIs on the message row (`attachments_json`),
  16 MB cap, and the pi bridge also writes each into
  `POP_AGENT_WORKSPACE/attachments/<chatId>/` so the agent's tools can open it.
- **Deleting a chat kills its work, then deletes everything it left behind.**
  `DELETE /v1/chats/:id` first stops what the chat has in flight
  (`RunService.discardChat`): the running attempt is aborted — which reaches
  down to pi killing the engine's process group — and anything of that chat
  still waiting for a slot is dropped without ever reaching the engine. Only
  then do the SQLite rows go (cascade), pi's JSONL session file and its
  sidecar folder, and the chat's `attachments/<chatId>/` directory — no
  orphans. **The order is the point**: a run still streaming into rows that
  are about to disappear would keep a process group alive, keep spending the
  user's own credit, and end by failing a foreign key. The aborted run unwinds
  afterwards, finds its chat gone, and stores nothing. The live pi session, if
  cached, is disposed first so nothing rewrites the file after it is gone.
  FTS5/embedding rows go by the same cascade once they exist.
- **Files** live in `POP_AGENT_DATA_DIR/files/` as a plain folder tree with real
  names (§14) — the disk is the record; there is no artifacts table. The only
  thing the database keeps is `file_provenance`: an append-only log of which
  chat wrote which path and when. It is history, not state — a later rename
  does not update it, and nothing breaks when it points at a name that moved.
  Deleting a chat leaves the user's files alone.

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

## 8. Skills with local mini-RAG selection ⭐ (the **Skill Router**)

Pop Agent ships a small roster of built-in skills (1.74: seven — the manual,
the codebase self-map, web research, note-taking, shell safety, the daily
review and code work) but injects only the relevant ones per user message —
selection is 100% local, no LLM call:

- Skill format: two coexisting shapes in `POP_AGENT_DATA_DIR/skills/` —
  (a) the original flat `<slug>.md` with `name` + `description` +
  `whenToUse` frontmatter (built-ins seeded from the repo keep this), and
  (b) the **Agent Skills standard** (agentskills.io): a directory holding
  a `SKILL.md`, discovered recursively (a skill directory's inner folders
  are assets, not skills). Slug = directory name; `whenToUse` falls back
  to `description`. Flat wins on a slug collision. Decided 01/08: the
  ecosystem converged on the standard and **pi implements it natively**,
  so Pop Agent adopts it in her own scanner rather than patching/translating
  pi (a patch would break on every pi update). New self-authored skills
  prefer the folder shape; both shapes route identically.
### Auto-Skills: reviewed background learning (12/08/2026)

- **Exactly three sources:** `builtin` (ships with the app), `user` (Personal,
  controlled by the owner), and `auto` (published by this pipeline). Editing an
  Auto-Skill promotes it to `user`. Automatic work may revise only `auto`; a
  Built-in or Personal match is a `protected_duplicate` and stops locally.
- **One setting:** `autoSkillsEnabled: boolean`, factory default `true`. The old
  `disabled | medium | full` values migrate as disabled → false and either enabled
  mode → true. Disabled stops new learning but does not disable existing skills.
  There is no pending state, approval endpoint, approval filter or revision inbox.
- **Invisible background process.** The chat agent cannot write skills or narrate
  internal decisions. An explicit multilingual request only prioritises that chat and
  skips the idle wait; it never bypasses a safety gate.
- **Canonical fail-closed pipeline:**

  `eligibility → taint → creator → parse/schema/English contract → policy gate →
  secret scrub → normalization → dedup → review envelope + review_hash → reviewer →
  final validation → recoverable publication + immediate indexing`.

  On its first evaluation, a conversation whose raw message-content total is below 500
  characters advances its watermark as `below_minimum_content` without either LLM call;
  later short increments remain eligible so concise corrections are not lost. A tainted window
  likewise advances without an LLM call. A conversation whose last implementation run failed
  or was interrupted without a later completed answer is also ineligible before either LLM:
  a plan, analysis, authorization or attempted implementation is not evidence of a procedure
  that worked. The creator and reviewer are fresh, isolated
  service completions with fixed English prompts. Creator output is
  marker-delimited Markdown (never JSON), includes stable evidence message ids, and may
  contain up to five candidates. Both stages require a plausible future need for this user
  after the current conversation and fix are complete; theoretical reuse by somebody is
  insufficient, and one-off product fixes already incorporated into code are rejected with
  `unlikely_future_reuse` unless a credible recurring workflow or independent trigger remains.
  The reviewer receives the sanitized original window and only surviving candidates as
  untrusted data; it returns exactly one APPROVE/REJECT block per `review_hash`. Approval
  requires `evidence_confirmed,reusable,complete`; rejection requires a controlled rejection
  reason. Missing, inconsistent, duplicate, unknown, truncated or mismatched verdicts publish
  nothing and do not advance the watermark.
- **Deterministic policy veto:** normalize NFKC, remove zero-width characters, collapse
  whitespace and block versioned classic injection/identity-override/future-agent patterns.
  A match is never rewritten or rescued. False positives are accepted unless real use shows
  systematic blocking that makes the feature inoperable; no minimum publication rate exists.
  Secret scrubbing, schema/size limits, source protection and final revalidation are likewise
  mandatory outside model judgment.
- **Dedup remains measured:** cosine ≥ 0.88 AND vocabulary overlap ≥ 0.25. The full vault,
  including archived skills, remains comparison material. A match against `auto` proposes
  `revision`; a match against `builtin`/`user` ends as `protected_duplicate` without
  spending the reviewer call. Exact duplicates and likely rewordings (high body-vocabulary
  overlap without substantial expansion) also terminate locally before review. A published
  automatic revision starts a 30-day per-slug cooldown before another may be reviewed.
  Precision beats aggressive merging or revision churn.
- **Review binding:** the SHA-256 `review_hash` covers normalized sanitized content, action
  (`new`/`revision`), target slug, target-version hash and nearest dedup neighbour. An
  approval for creation cannot authorize a revision, and a target changed after review fails.
- **Recoverable publication:** the vault writes a same-volume temporary file, fsyncs a durable
  backup for a revision, persists a SQLite `prepared` journal row, atomically renames, updates
  vectors/history/watermark, then commits and cleans up. Prepared slugs stay invisible to the
  router. Boot reconciliation rolls back prepared work or finishes committed cleanup. The
  previous revision remains as one-level rollback history.
- **Watermark:** advances on taint, valid empty output, deterministic/reviewer rejection,
  protected duplicate and successful publication. Provider, parser, reviewer/hash, write or
  transaction failure does not advance and is retryable. One conversation per scheduler tick
  remains the cost ceiling; creator/reviewer service runs are booked with distinct purposes.
- **Retention and visibility:** at most 1000 active Auto-Skills; least-used overflow is archived,
  never deleted. Archived entries leave routing but remain recoverable and deduplicable. Learning
  activity stays internal rather than appearing in the Skills navigation; failures that require
  user action should surface as specific, actionable notices. Existing router selection remains
  local and injects only its small top-N, so vault size does not equal prompt size.

- **Skill language**: skills the agent writes for itself are English —
  name, slug, frontmatter, body — same rule as the repo. Skills the end
  user uploads may be in any language; the router's semantic leg is
  multilingual and the lexical leg leans on translation-stable tokens.
- pi's native behavior (progressive disclosure: ALL descriptions in the
  system prompt) does not scale to dozens of skills and models often skip
  reading them. Pop Agent's selector replaces it.
- **Selector (built; 1.60 describes what exists).** Two rankings, fused
  with the same `fuseRankings` (RRF) the memory search uses — one function,
  not a second mechanism:
  - **lexical**: IDF-weighted token overlap between the message and each
    skill's name/description/`whenToUse`, computed in JS over the vault.
    Not FTS5: skills are markdown files in a folder, not rows, so there is
    no index to query.
  - **semantic**: cosine over `skill_embeddings`, one vector per skill.
  A skill enters a ranking only by clearing that ranking's bar. **RRF orders
  candidates; it does not create them** — that is what keeps an unrelated
  message selecting nothing at all. Either signal alone qualifies a skill;
  one both agree on outranks one only a single ranking found.
- **The semantic bar is relative, not absolute** (measured 07/08 against
  the real 24-skill vault). Over 192 query/skill pairs e5 cosines ran
  0.70–0.84 with p90 at 0.80, and the right skill for "the square root of
  1444" scored *below* that noise — there is no absolute line to draw. The
  gate is therefore a z-score over the spread of that one request:
  `z ≥ 2.1`, with 0.75 kept as a floor beneath it. On ten labelled requests
  that admitted five of eight real matches and neither of the two noise
  hits. Precision first: the lexical ranking is there to catch the rest, and
  a wrong skill costs one of three slots on every turn.
  **Too few measured skills for a z (< 5) does not mean the bare floor**
  (1.72): 0.75 sits inside the noise band, so a small vault would admit its
  luckiest member. The small sample gets the band's own p90 instead —
  `max(floor, 0.80)`.
- **Vectors are persisted** (`skill_embeddings`, migration 028). Keyed by
  slug and stamped with the routing text they came from, so editing a skill
  invalidates its vector and nothing else. A vector whose length disagrees
  with the current embedder is dropped rather than compared. Cold start
  16.3s, warm 2.0s on the real install.
- **The index covers the vault; the filter is on the selection** (1.65,
  found in production). `skill_embeddings` answers two questions, not one:
  which skills may take a slot this turn, and what the distiller's dedup
  compares a candidate against. Routing excludes pinned and disabled skills;
  **indexing excludes nothing.** Historically the router filtered before it
  indexed, so a then-pending skill never got a vector, and the distiller — whose
  whole dedup leg reads this table — compared every candidate against a set its
  own recent work was missing from. A background task opening a fresh chat every
  hour turned that into nine copies of one procedure. The reviewed pipeline has
  no pending state, but the full-vault indexing invariant remains.
- **The distiller stores the vector of the skill it writes** (1.65), rather
  than leaving it for the next user message: `candidateRoutingText` and the
  router's `routingText` are the same string, so the vector the dedup just
  computed is exactly the one the router would compute. Nothing else would
  store it in time — the router indexes when a message arrives, and the
  distiller runs on a timer. A tick every ten minutes cannot dedup against
  work that only gets indexed when somebody happens to chat. It is stored
  even when the table was empty and nothing was compared: returning early on
  an empty table is why the first skill of a fresh install was never indexed
  and the second could not be measured against it.
- **`use_count` / `last_used_at`** (`skill_usage`, migration 029): the
  router records every skill it injects. A counter and a stamp, not a
  boolean — a skill used twice a year must be distinguishable from one used
  never, which is what a fixed "90 days idle" rule cannot do. This is the
  evidence the archiving collector reads when the 1000-Auto-Skill safety cap
  is exceeded.
- Verify while coding: whether the SDK can scope which skills pi exposes
  per session/turn; if not, Pop Agent injects the selected skills as its own
  context and disables pi's native listing.

**Self-knowledge hardening** (designed in 1.25–1.26, built in 1.27):

- **Pinned skills.** A skill can be marked `pinned`. Pinned skills bypass
  the router and enter the **session system prompt once** (provider-cache
  friendly) — never the per-turn prepend, which would repeat them through
  the history. Identity is a prerequisite of every answer, not a
  situational skill: `know-thyself` ships pinned. The pinned set stays
  tiny and short (guideline: ≤2 skills, each about the size of today's
  know-thyself) — a fat pinned set recreates the scaling problem the
  router exists to solve.
- **Router observability.** The skill-router service logs, per turn, which
  skills were selected and with what scores. It logs **both components**,
  not just the fused one — `slug(rrf=0.0323 lex=3.22 cos=0.775)` — because
  the bars live on the component scales and a log of RRF alone could not
  tune either. Thresholds are tuned from these distributions, never
  guessed: e5-family embeddings compress cosine into a narrow band
  (unrelated pairs often score 0.70–0.80), so intuitions like "0.75 is too
  strict" do not transfer.
- **PT/EN routing gap — and what it actually costs.** User messages arrive
  in Portuguese; skill descriptions are English (repo language rule).
  Measured 07/08 on ten labelled requests: the lexical half alone found
  **two**, and both were requests whose right answer was "nothing" — its
  single real hit was `web-browsing` on "procura na internet", and only
  because "internet" is spelled the same in both languages. The fused
  router found seven. **No better lexical engine would change that** —
  FTS5, bm25, a real stemmer all rank word matches, and across languages
  there are no word matches to rank. The semantic leg is what carries
  recall here, which is the standing answer to "why not just match words?".
  `whenToUse` texts must still carry translation-stable trigger tokens
  ("typescript", "stack", "skill", "architecture"…), and a trigger that has
  to fire on an exact sentence carries that sentence in several languages
  (see `skill-creator`). Real PT dialogues that misrouted become test cases.
- **`self-architecture` skill** (routed, not pinned): the deep self-map —
  clean-architecture layers and the dependency rule, the monorepo layout,
  where Pop Agent's own source lives on the server (Pop Agent has bash; it can read
  its own code once it knows the path), and the decision rule: **Pop Agent's
  extensions are TypeScript on Pop Agent's own runtime**. The repo-map section
  is **generated from the code by a script** (runs with the gate), never
  hand-written — the spec stays the normative source; the map is derived.
- **UI map (navigation self-knowledge).** The agent runs server-side: it
  has no browser, no DOM, no accessibility (AX) tree of the PWA it fronts
  — a live AX tree exists only in the user's browser, out of reach by
  design. The equivalent knowledge is static and derivable: router paths
  in `web/src/App.tsx` and every visible label in `web/src/i18n/en.ts`
  are the source of truth for screens, menus and Settings sections. The
  self-map generator therefore also emits a **UI map** — routes, Settings
  sections, what each does — so Pop Agent directs the user through its own
  interface ("Settings → Model") instead of guessing. Same rule as the
  repo map: generated, never hand-written.

## 9. Auth and secrets

- **Password only** (no username) — vault-style login. Hash: argon2id at
  64 MB / 3 passes / 4 lanes, stated explicitly so a future library
  default cannot quietly weaken existing installs. Length is the only
  rule: 10–128 characters, no composition requirements.
- First run: `/setup` wizard — password → recovery key → provider
  (skippable) → done. The key is shown exactly once, with a mandatory
  "I saved it" confirmation, a copy button and a `.txt` download.
- **Recovery key format**: 24 symbols in six groups of four, drawn from a
  31-character alphabet that omits the pairs people misread (no `0/O`, no
  `1/I/L`) — roughly 118 bits. Symbols come from rejection sampling rather
  than folding random bytes with `%`, which would make the first eight
  measurably more likely. Input is normalised (upper-cased, separators
  stripped) so case and hyphens do not matter when typing it on a phone.
  Only a SHA-256 of the normalised key is stored: the key is
  CSPRNG-generated, so there is no low-entropy guess space for a slow hash
  to defend.
- **Recovery spends the key**: a successful recovery mints a *new* key and
  invalidates the one used. A key that stayed valid after use would be a
  permanent master password nobody remembers handing out.
- **Session token**: stateless, HMAC-SHA256 signed
  (`base64url(payload).base64url(sig)`, payload `{epoch, iat, exp}`,
  constant-time compare, ~60 lines over `node:crypto`). No JWT lib —
  evaluated and rejected. Exp 7 days. **Sliding renewal**: a token
  over 24h old comes back refreshed in the `x-pop-agent-token` response header
  and the client swaps what it stored — somebody who opens Pop Agent weekly
  never meets the login screen, while a token idle for the full week
  still dies. **Epoch** increments on password change, on recovery and on
  **"Sign out other devices"** (Settings, v0.1): every other session
  drops, and the device that acted receives a token on the new epoch,
  because signing yourself out of the button you just pressed is a
  confusing way to be told it worked.
- **Rate limit and lockout**, both in memory (one process, one account):
  10 requests per minute per origin on the credential routes, plus a
  progressive lockout on wrong answers — four free misses, then 30s
  doubling per failure to a fifteen-minute ceiling, reported as exact
  seconds so the UI counts down honestly. A correct password or a valid
  recovery key clears it. A restart clears it too: that is a deliberate
  trade against writing an attacker-driven counter to disk.
  `GET /v1/auth/state` is exempt from the rate limit — it reveals nothing
  and the app asks for it on every boot, so throttling it would let a
  user lock themselves out by refreshing the page.
- Frontend storage: `sessionStorage` by default; "Keep me signed in"
  checkbox → `localStorage` (essential on mobile PWA).
- **Pop Desktop Manager session (macOS):** the manager authenticates through
  the same `POST /v1/login { password }` contract and stores only the returned
  session token as a macOS Generic Password. Service is
  `com.wails.pop-desktop-manager`; account is the normalized server origin.
  The password is request-only and is never persisted. Startup validates the
  token against a guarded endpoint, replaces it when
  `x-pop-agent-token` renews the session, distinguishes an unreachable server
  from `invalid_session`, and deletes an invalid token. This introduces no
  second device credential or authentication protocol.
- **Biometric unlock via WebAuthn/passkey** (Face ID on iOS 16+ installed
  PWA; fingerprint/face on any recent Android Chrome — same code): after a
  password login, Settings offers "Enable Face ID unlock" →
  `navigator.credentials.create()` registers a passkey
  (`@simplewebauthn/server`; credentials in SQLite, single-use challenges
  with short TTL). Login screen then offers "Unlock with Face ID" →
  `navigator.credentials.get()` → server verifies → issues the SAME HMAC
  session token. Passkey only replaces typing the password; password +
  recovery key remain the fallback. Requires a stable HTTPS hostname
  (`rpId` is bound to it — changing hostname invalidates passkeys) and
  feature detection (`window.PublicKeyCredential`) to hide the button
  where unsupported. Never `getUserMedia` — biometrics stay in the
  device's secure hardware.
- **Provider secrets**: SQLite is not fully encrypted (your own VPS, honest
  threat model). Secrets column is encrypted with the key in
  `~/.pop-agent/secret.key` (0600), which is **excluded from backups** — a
  leaked backup leaks no keys; restore on a new machine = re-enter keys. The
  session HMAC secret lives in the same table for the same reason.
  Root-level attackers are out of scope and the README says so.
- **Type-enforced route protection**: an unauthenticated URL must not
  compile. Route groups reach the app only through `mountApi()`
  (interface/http/route-registry.ts), which accepts branded
  `SessionGuardedRoutes` or a `publicSurface(reason, …)` — a bare Hono
  does not typecheck, so going public is a loud, greppable act with a
  written reason. `PUBLIC_V1_PATHS` in the same file is the single
  source of truth for guard exemptions (the auth middleware derives its
  allowlist from it; no duplicated literals). The runtime half: the
  probe in route-guard.test.ts walks every registered /v1 route and
  fires it without a session — anything not on the declared list must
  answer 401, and the HMAC download surface must answer 4xx without a
  valid signature. Future compile-time invariants on the same pattern:
  SecretString branding, so key material cannot flow into a log or a
  response type.

## 10. External-content safety (`domain/safety/`)

Mandatory because the agent runs full-power (§5). Deterministic layer (no
LLM) over everything from outside — web, files, notes, tool output:

- Strip invisible characters (zero-width, bidi, tag chars); NFC
  normalization; flag long base64 blobs; extract URLs.
- Multilingual prompt-injection regex table (PT included; aw's table as
  conceptual reference, rewritten).
- Untrusted-data envelope with delimiters ("data, never instructions").
- **Per-turn taint**: if a turn consumed suspicious external content it
  becomes tainted for the rest of that turn. Under YOLO mode (the owner's
  call, 31/07) there is no confirmation card and the user is never asked;
  the brake is automatic instead. This is the ONLY brake on yolo mode.
- **YOLO is about the AGENT, never about the person's thumb** (Vinicius,
  03/08). It means a run does not stop mid-task to ask permission. It does
  not mean the UI is free of dialogs: a destructive tap the *user* makes —
  deleting a folder and everything under it, a batch delete — still asks
  first, because a ⋯ menu on a phone puts Delete a few millimetres from
  Rename and there is no undo behind it. A confirm must state the real
  blast radius (the whole subtree's file count, not the direct children's).
- **Implemented via pi's own `tool_call` / `tool_result` extension hooks**
  (an inline extension Pop Agent registers; `noExtensions` still keeps the
  host's out). A run whose tool output sanitizes as suspicious/high
  becomes tainted; in a tainted turn a bash command that would **exfiltrate
  or read a secret** (curl/wget uploading a file, `curl -d/-F @file`,
  pipe-to-network, scp/rsync out, netcat, or reading secret.key / .env /
  pi-auth.json / id_rsa / .ssh) or **destroy irreversibly** (rm -rf, sudo,
  dd, mkfs, chmod/chown -R, pipe-to-shell, fork bomb, redirect outside the
  workspace) is refused right there: the tool call returns an error telling
  the model this turn is tainted, so it carries on without that command. No
  dialog, no `POST /v1/chats/:id/confirm`. A clean turn runs anything (full
  YOLO). Every refusal is logged (`onFailure` code `turn_tainted`), so the
  trail survives. Only the exfil/secret/destruction shapes are gated —
  gating every command would cripple ordinary tainted work.

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

## 12. Web access (`infrastructure/web/`)

- v0.1: `web_fetch(url)` — fetch + Readability extraction + safety envelope
  (§10). pi has NO native web tools (confirmed) — this is a Pop Agent custom
  tool.
- Later: `web_search` (engine TBD) and Playwright for dynamic pages.

### MCP clients (`infrastructure/mcp/`)

MCP protocol mechanics belong to the official TypeScript SDK v2, behind the
application-owned `McpClientFactory` port — no hand-written JSON-RPC framing.
`stdio` and Streamable HTTP negotiate with `server/discover` first, selecting
the stateless 2026-07-28 era when available and falling back to the legacy
`initialize` era otherwise. Explicit HTTP/SSE remains legacy-only. Era verdicts
are cached for ten minutes per server configuration and authorization scope;
failures evict them. Settings records and shows `modern/stateless` or `legacy`
and the negotiated version. Discovery covers tools, resources/templates and
prompts. The SDK owns pagination, request-scoped SSE, cancellation, modern
per-request metadata and required HTTP headers, sessions for legacy servers,
and stdio child cleanup. A stdio child inherits only the SDK safe environment
plus that server's encrypted variables, never the full Pop Agent environment.
MCP results remain untrusted external content under §10. Full rationale and
contract cases: `docs/mcp.md`.

## 13. API contract

Everything under `/v1`. Errors always structured:
`{"error":{"code":"…","message":"…","status":401}}` with stable codes
(`invalid_credentials`, `invalid_session`, `locked`, `rate_limited`,
`chat_not_found`, `run_in_progress`, `missing_field`, `operation_error`…).

Routes: `GET /v1/auth/state`, `POST /v1/setup`, `POST /v1/login`,
`POST /v1/auth/recover`, `POST /v1/auth/change-password`,
`POST /v1/auth/sign-out-others`, `GET /v1/about`, `GET /v1/events` (single
SSE channel), `GET|POST /v1/chats`, `PATCH|DELETE /v1/chats/:id`,
`GET|POST /v1/chats/:id/messages`, `POST /v1/chats/:id/stop`,
`GET|PUT /v1/settings`, `GET /v1/models`, `GET /v1/providers`,
`PUT|DELETE /v1/providers/:id/key`, `POST /v1/providers/:id/test` (the
key is write-only: no response anywhere carries it), `GET|PUT /v1/memory`,
`GET /v1/usage` (§14), `GET /v1/backups` (§16), `GET /v1/update/status`,
`POST /v1/update/apply`, `GET /v1/ax` (§18), `GET /healthz` (no auth),
`GET /v1/health` (no auth) — the sidebar's probe: `{server, provider, db}`
with `ok|error` flags, cheap and cached only (provider = key configured +
last run's outcome, never a paid call per poll; db = a `SELECT 1`; a
user-aborted run is not a failure). No answer at all means "Server offline".
WebAuthn: `POST /v1/auth/webauthn/register`, `POST /v1/auth/webauthn/login`
(§9, v0.2).

**The SSE stream is authenticated with a one-time ticket.** `EventSource`
cannot send an Authorization header, and a session token in a query string
ends up in access logs, proxy traces and browser history. So
`POST /v1/events/ticket` (authenticated) returns a CSPRNG ticket good for
**one connection and 30 seconds**, and `GET /v1/events?ticket=…` spends it.
A reconnect asks for a new one. The hub broadcasts every event to every
connection — one user, several tabs — and sends a `:ka` comment every 25s so
a proxy does not mistake an idle stream for a dead one.

`GET|PUT /v1/settings` is a **full replace**: PUT carries the whole
document and the schema is strict, so a field Pop Agent does not know is a 400
rather than something silently dropped. Public (no session):
`auth/state`, `setup`, `login`, `auth/recover`, `healthz`, `health` — and
`/v1/events`, until Phase 2 decides how to authenticate a stream that
EventSource cannot attach a header to. Any response may carry a refreshed
`x-pop-agent-token` (§9).

SSE events (typed in `shared/`): `delta`, `thinking`, `tool` (with
start/output/done/error — `output` streams stdout in real time), `done`,
`error`, `title`, `run-status` (`queued` | `running`, so the UI can say a
run is waiting for a slot rather than looking stalled), `update`. Every run has a `runId`; the frontend discards
events from stale runs.

## 14. Frontend rules (web/)

- The React app only paints. No business rules. Components never call
  `fetch`/`EventSource` — only `web/src/services/*` does (enforced by
  ESLint restricted-imports; gate fails otherwise). Types come from
  `shared/`, never redefined.
- Layout: ChatGPT-style without inventing — sidebar (chats, filter, New,
  archived), central column, composer. **The app bar (wordmark + Settings)
  lives at the BOTTOM of the sidebar**, floating above the endlessly
  scrolling list (the list keeps a padding-bottom so the last row is never
  hidden), and carries the **health indicator**: silence means healthy —
  nothing renders while `/v1/health` is all `ok`; a *degraded* server (it
  answered, but something inside is sick) shows a small gently pulsing red
  button (opacity animation, never stroboscopic) whose tooltip/click names
  the diagnosis ("LLM provider disconnected", "Database disconnected").
  Diagnosis only; maintenance actions come later. **Narrow screens follow the
  Telegram model rather than a drawer**: the list *is* the screen, and
  opening something is a route change, so the phone's back gesture means
  what the user expects.
- **A server the app cannot reach is announced, not hinted** — a full-width
  bar at the top of every screen (`ui/connection-banner`), above the router
  so the failed boot's fallback to login carries it too. The dot is for
  diagnoses the user could act on; an unreachable server is a wall, and the
  PWA hides it well: every screen still paints from the service worker's
  cache, so the app looks alive and only the answers stop. Three states,
  because the next move differs in each — **"You're offline."** (the device
  has no network: theirs to fix), **"Server is offline."** + *"Your internet
  is working — the problem is on the server. Nothing you typed was lost.
  Trying to reconnect…"* (naming the culprit is the point; without it the
  first suspect is always the wi-fi), and **"Back online."** for 3s, because
  an outage that ends in silence leaves you poking at the app to find out
  whether it is safe to type again. A bar, never a modal: the conversations
  already loaded stay readable. "Trying to reconnect…" is only honest if it
  is true, so the retry is real, plus a "Try now" button.
- **Connection cadence** (`services/health`): healthy it is a keepalive —
  one `/v1/health` a minute; unreachable it is a retry — 5s doubling to 30s,
  because the only thing anyone wants then is the moment it comes back.
  `navigator.onLine === false` skips the request entirely (nothing can
  succeed with the radio down) and tells the two failures apart. Nothing runs
  while the page is hidden: iOS freezes a backgrounded PWA within seconds, so
  a surviving timer would only resume holding a verdict from whenever the
  system suspended it — the poll stops on `pagehide`/hidden and fires
  immediately on `pageshow`/visible, the same pair `services/events` uses.
  **The wake-up probe matters more than the interval.** Every real request is
  also a probe: `services/api` reports a fetch that never landed at once
  (waiting up to a minute would leave a send that did nothing unexplained)
  and any answer, a 500 included, clears it just as fast.
- **Never a side drawer/panel for forms** (permanent veto). Settings is a
  full-screen view: Server, General, Model, **Audio**, Memory, Usage,
  Storage, Backup, Appearance, Updates, Security, About. Every Save has a
  Cancel. **Model means the model that answers you** -- the whisper model
  and the transcript cleanup moved out to Audio (Vinicius, 03/08), because
  under Model they sat beneath a heading about something else and anyone
  looking for the microphone had no reason to open it.
- Rendering v0.1: markdown (react-markdown + remark-gfm, sanitized, no raw
  HTML) + code highlight (Shiki, themes synced light/dark, copy button,
  language label). Mermaid/KaTeX: later.
- Streaming UX (aw's machine as reference): runId registry, reload
  reconciliation mid-run, polite autoscroll + "jump to latest", auto-title
  via SSE, and per-chat drafts in localStorage. Delta, thinking and tool
  fragments are delivered to React at most once per animation frame, and
  settled transcript rows keep stable memoized renders: a long conversation
  must not reparse all historical Markdown for every new fragment. Lifecycle
  events flush queued fragments first and remain immediate. While an answer
  streams, any reader gesture toward older content suspends autoscroll immediately, before
  iOS applies its native scroll; the intent listener stays passive and the
  floating control must not resize the scroller or interfere with native pan.
  Streaming must not pull the viewport back to the bottom. Following resumes
  only when the reader moves back to the latest content or taps "jump to
  latest". The transcript itself never scrolls horizontally: ordinary text,
  paths and long tokens wrap within the column, while code and tables retain
  their own bounded horizontal scroll areas. The document root is horizontally
  contained too, and the pane, transcript viewport and composer form each keep
  the same containment before and after focus; focusing the composer cannot
  merely shift an outer page overflow out of sight. **Run activity is a separate line immediately above the composer,
  in both web and CLI**: queued is a static “Waiting for a free slot…”, running
  is a locally animated Braille spinner plus “Working…”, and `done`/`error`
  removes its content. The web permanently reserves the line's height so an
  answer settling never shifts the transcript vertically. Text, thinking and
  tool cards never replace this line; tool
  spinners describe one call, while `run-status` describes the whole run. The
  clients animate locally -- SSE never carries presentation frames. Thinking
  is visible by default in both clients. The web stores that choice in device
  localStorage; the CLI stores it in its separate device-local preferences
  file. `/think` redraws live, settled, historical and pre-steering assistant
  segments immediately, and settlement never discards reasoning already shown.
  The **pending-input FIFO is
  server-owned**: ordered SQLite rows survive restart. The complete FIFO is
  returned with the message snapshot, while incremental add/edit/remove events
  keep phone, desktop and tabs in sync; the current head remains on the wire for
  older clients. Every pending input stays visible with edit/cancel controls,
  and the composer remains available to append more. A POST racing an active
  run appends atomically; the defensive ceiling is 1,024 pending inputs per
  chat, so only item 1,025 is
  refused with `queue_full`. While pi is running with the same terminal local connection,
  Pop offers every contiguous `steer` item through pi's native steering queue
  and explicitly sets `steeringMode=all`: the whole accepted batch enters after
  the current assistant turn and its tool calls, before the next model call.
  Each item stays durable until pi emits its matching user-message event.
  `/queue <message>` is a FIFO barrier and the explicit escape hatch to the old
  behavior: it persists
  `delivery_mode=follow_up` and is not offered to pi until the live run ends.
  Delivery persists the assistant segment before it, inserts the user bubble,
  advances the FIFO and continues under the same run id. Pending inputs are
  painted in FIFO order as ordinary user bubbles: the steering head says
  `Sending:`, later steering says `Waiting:`, and explicit follow-up says
  `Queued:` because it waits for the current run to finish. No separate composer
  strip exposes the internal steering vocabulary. Until pi emits that
  user-message event the SQLite row remains authoritative, so a restart or an
  unavailable steering channel degrades into the ordinary follow-up path instead
  of losing input. ID-addressed PUT and DELETE edit or cancel any pending item;
  the legacy routes still target the head. Text, uploads and Files references
  survive PWA reclamation and server restart.
  Legacy `pop-agent.queued.*` localStorage rows migrate on first open.
- **Adoption**: an event for a chat with no live buffer starts one, so a run
  begun on another device streams into every open window. Runs that already
  ended are remembered briefly, so their stragglers are ignored rather than
  adopted as something new.
- Context menus are **visible buttons, not long-press**: a hidden gesture has
  no affordance on a touch screen and fights the scroll, and hover-only
  controls are invisible to keyboards.
- Thinking: collapsed streaming card. Tool calls: card per call with
  real-time output; consecutive calls group. Sensitive-action confirmation
  renders inline in the chat (§10).
- Chat titles: a chat is born with the deterministic starter **"Chat N"**
  (lowest free N among the living chats) and keeps it through the user's first
  two messages. There is no first-message word-picking rename.
- Auto-title (LLM): ONE background call after the 3rd user turn writes TITLE
  (≤40 chars, at most six words) + SUMMARY together, using the chat provider's
  service model and the conversation's language. It is a one-time naming pass,
  not a periodic rewrite. A refused request, unavailable provider or unusable
  parse (<2 chars = failure) leaves **"Chat N"** untouched. Manual rename
  disables auto forever, and a successfully titled chat is not revisited.
  Every skip logs its reason (manual-rename, cadence, already-titled,
  same-title…) so "why didn't it rename?" is one log line. The summary lands on
  the chat row and feeds the recent-chats catalog (§7.1) — infinite chats stay
  indexed. `chat_titles` is append-only: every title, its user turn,
  auto|manual.
- **Usage dashboard** (Settings → Usage): full cost control from
  `llm_runs` — per day, per provider, per model, per conversation.
- Files the agent creates: download link in chat when a tool reports a
  file + a workspace file browser.
- Slash commands: `/model`, `/new`, `/memory`; extensible menu on `/`.
- Voice (v0.2): aw's pipeline copied as-is — MediaRecorder → upload →
  ffmpeg (WAV 16k mono) → whisper.cpp (`whisper-cli`, `base` default,
  HF download with SHA1 pin, `-l auto`) → best-effort LLM cleanup. Check
  in aw whether the transcript lands in the composer and replicate.
- UI in English; strings structured in a light i18n layer from day one
  (simple dictionary, no heavy lib) so PT-BR can land later without
  retrofit.
- Icons: Lucide. No emoji as icons. Toasts: own implementation, top-right,
  theme-tinted, async events only; form errors inline.
- `data-testid` on every interactive control, kebab-case and named after
  the thing (`setup-password`, `login-submit`, `settings-theme-dark`);
  basic real a11y (visible focus, keyboard nav, `aria-live` on streaming).
- **Every field control comes from `ui/controls.tsx`** — `TextField`,
  `Select`, `TextArea`, `CheckField`, plus `Button`, `Card` and
  `Segmented`. A hand-rolled `<select>` or `<textarea>` with its own class
  string is a bug waiting to be fixed N times; they had already drifted
  apart before the primitives existed. The field skin lives in one
  constant and the two sizes (`md` for a labelled form field, `sm` for a
  toolbar control) are a **prop, never a `className` override**: two
  competing `px-` classes are settled by the order Tailwind emitted them,
  not the order they were written.
  - A primitive given no `label` renders bare, so a toolbar keeps its flex
    row instead of gaining a wrapper — and then `aria-label` is mandatory,
    because it is the only name the tree will ever get.
  - Layout classes (widths, `flex-1`) still come through `className`; only
    the skin is owned by the primitive.
  - `tools/check-ui-primitives.ts` parses production TSX before TypeScript and
    rejects native `button`/`input`/`select`/`textarea` outside the primitive
    implementation, hand-written menu shells, duplicate focus treatments,
    literal component colors and private skins passed through `className`. A
    new kind of control is added to `ui/controls.tsx` first; feature
    code cannot create a private visual dialect. The maintained catalog and
    usage rules live in `docs/ui-style-guide.md`.
- Theme: follows the system (`prefers-color-scheme`) + manual
  System/Light/Dark override. **Never sent to the server** — it belongs to
  the device, lives in `localStorage`, and is applied by an inline script
  before the first paint so the wrong colours never flash. Two token maps;
  regression test: every theme defines every token. App icon: friendly mascot, designed later — v0.1
  ships a simple placeholder.
- PWA: app-shell precache; API/SSE never cached; SW update prompt. iOS:
  HTTPS required, safe-areas, `dvh`. Android: WebAPK via manifest. Offline
  is honest: shell + "Pop Agent is offline". Web Push in v0.2 — exactly two
  triggers: "run finished" and "agent needs confirmation" (the second is
  still to be wired).
- **Web Push, end to end**: `push-sw.js` is imported into the generated
  service worker (`workbox.importScripts`) and owns `push` (always shows a
  notification — `userVisibleOnly` demands it) and `notificationclick`
  (focus an open window at the deep link, or open one). Settings →
  Appearance carries the device-scoped opt-in, which asks for permission
  inside the click itself (iOS refuses a prompt that is not in a user
  gesture) and registers the subscription with `/v1/push/subscribe`. A
  finished run calls `PushService.send`; a subscription the service reports
  gone (404/410) is deleted.
- **The VAPID `sub` claim is not a formality.** It is a contact URI for the
  application server, and Apple *validates* it: `web.push.apple.com`
  answers **403 `BadJwtToken`** for a subject it dislikes, silently — the
  phone simply never rings and nothing in the UI says why. `@localhost` is
  the trap: a perfectly good address for a machine talking to itself, and
  not a domain Apple accepts. Pop Agent signs with a real public URL by default;
  `POP_AGENT_PUSH_SUBJECT` sets the operator's own `mailto:` or `https:` URI,
  and a value that would be rejected upstream is **dropped for the default
  rather than honoured** — a typo in an environment variable must not
  quietly switch every notification off.

### Files as a plain folder (supersedes RF-001–019)

> Redesigned in 1.58: Files stopped being a catalog over id-named blobs and
> became a directory. The paragraphs below are the target state; the previous
> design (`save_artifact`/`read_artifact`, id-addressed downloads, versions,
> the path index) lives in the changelog if a rollback ever needs it.

- **`POP_AGENT_DATA_DIR/files/` is the single source of truth.** Real names, real
  subfolders. The Files tab renders the tree as it is on disk — a `readdir`
  walk, no `artifacts` table, no `file-` ids, no path index. What `tree`
  shows over SSH is exactly what the tab shows. Hidden entries (dotfiles)
  are reserved for Pop Agent's own metadata and are never listed.
- **The agent sees Files as a folder.** `Files/` is exposed inside the
  workspace root, so the built-in `read`/`write`/`bash` tools already cover
  it: "save something for the user" means writing `Files/relatorio.pdf`.
  `save_artifact` and `read_artifact` retire. The system prompt teaches one
  rule — *a file the user asked for is not done until it exists under
  `Files/`; the rest of the workspace is scratch.*
- **Overwrite is the feature.** Saving a name that exists replaces it. No
  versions, no history (`artifact_versions` is gone). What the user wants
  from "save it again" is the new file (Vinicius, 05/08).
- **Provenance is a log, not a catalog** (Vinicius, 05/08): the
  `file_provenance` table (§6) records "chat X wrote `Files/foo.pdf` at T",
  append-only, written by the server as it serves the tree. It answers
  "which files did this chat produce" without ever having to be right about
  where the file is *now* — history cannot desynchronize.
- **The trash is a folder.** Deleting from the UI moves the entry into
  `files/Garbage/`; the agent deletes through a **`delete_file(path)` tool
  whose real effect is that same move** — never `rm` (Vinicius, 05/08: a
  rule enforced by a tool beats a rule taught in a prompt). A hidden
  `Garbage/.garbage.json` records `{originalPath, deletedAt}` per entry —
  the `.trashinfo` idea from the Linux desktop. Restore moves it back; a
  daily sweep purges what is older than 30 days. Self-healing by design: a
  file with no entry purges by its own mtime and restores to the Files
  root; an entry with no file is dropped on the next sweep. The delete endpoint
  returns the exact Garbage entry it created (collision-safe handle included),
  and the UI immediately shows an actionable “moved to Trash” notice with
  **Restore**; batch undo restores parents before separately selected children.
- **Downloads stay HMAC-signed, now over the path.**
  `GET /files/download?path=<rel>&expires=<ms>&sig=<b64url>` — the
  signature covers path+expiry and is checked before the expiry, so
  tampering with either fails as a bad signature. Path resolution refuses
  `..`, absolutes and symlink escapes (the same jail the workspace already
  has). 403 forged, 410 expired, 404 unknown; expiry is a property of the
  link, and a fresh one can be minted any time.
- **Search is by name, live.** `files_search(query)` walks the tree at
  query time and matches names and paths — no index, no watcher, no
  embeddings (Vinicius, 05/08: names only for now). Content search, if it
  ever returns, is an index keyed by path+mtime, out of scope here.
- **Uploads** (`POST /v1/files`, multipart, 25 MB cap) land in the folder
  open in the tab (the root by default). Multimodal input is unchanged:
  image attachments still go inline to models that accept image input;
  text-only models keep the file-on-disk path.
- **Migration**: one boot-time walk of the old `artifacts` table writes
  each latest version to `files/<folders>/<name>` (older versions are not
  carried over), seeds `file_provenance` from the rows' chat ids, then
  drops `artifacts`, `artifact_versions` and the folders table and removes
  `POP_AGENT_DATA_DIR/artifacts/`. `FilesReindexJob` and the id-based routes go
  with them.

## 15. Providers, models, updates

### Multi-provider (fase 1)

Design copied conceptually from the Agent Workspace; transport and
catalog come from pi (`ModelRuntime` + pi-ai `Models`), never
reimplemented.

- **Provider is data, not a class**: a declarative list of definitions
  `{id, name, baseURL, authType, defaultModel, allowCustomModel}`.
  `authType` is `"api-key"` or `"oauth"` (fase 1.5 below); vendor
  quirks get a point `if`, not a subclass. Adding a provider = adding
  a literal.
  Phase 1 ships: OpenRouter (default, **default model: Kimi K3**),
  OpenAI and Anthropic. Fase 1.5 adds the OAuth pair pi supports
  natively: `openai-codex` (ChatGPT subscription) and `github-copilot`
  (Copilot subscription). Custom OpenAI-compatible endpoints are
  user-created instances, unlimited (below).
- **Unlimited custom providers**: the registry (settings key
  `provider.custom.registry`) holds `{id, name, baseURL, defaultModel}`
  per instance; ids are `custom-` + 5 random hex bytes, re-rolled on
  collision. Each instance's key is sealed under its own id
  (`provider.<id>.apiKey`) and deleted with it. The definition list
  everything consumes = builtins + one synthesized definition per
  instance (customs join resolve/chain after the builtins, in registry
  order); the engine registers each instance with pi lazily on use, so
  adding or editing one needs no restart. Base URLs are normalized on
  save (trailing slashes and a trailing `/chat/completions` stripped;
  the card shows "requests go to" live). Routes:
  `POST /v1/providers/custom` (create → id),
  `PATCH|DELETE /v1/providers/custom/:id`; the single-slot era's
  `PUT /v1/providers/custom/config` is REMOVED. Migration: on boot, a
  legacy `provider.custom.config` and/or `provider.custom.apiKey`
  becomes one registry instance (key and all), the legacy entries are
  cleared, and `provider.custom.alias` remembers the new id so a chat
  override still saying `custom` resolves to it.
- **Model identity = the pair `(providerId, modelId)`**, always. No
  synthetic string of our own; each provider names the model its way.
  Everywhere that stores `model` today (settings, chats, llm_runs) now
  stores the pair; migration treats the old value as OpenRouter
  (backfill `provider='openrouter'`).
- **Keys are write-only**: the UI never reads the key back (input starts
  empty, placeholder "••• configured" when one exists); no endpoint
  returns key material (only `hasKey: boolean`); keys never in logs,
  model context or tool results. Storage: the existing encrypted
  secrets column (secret.key), one row per provider.
- **Saving ≠ activating**: saving a key/config never hits the network.
  Validation (one real ~5-token completion, "Reply with exactly: ok")
  runs only on explicit activation/test; if it fails, the typed config
  IS kept with a warning — a bad key must not destroy what the user
  typed.
- **Model catalog in 3 layers**: live (ModelRuntime refresh now) →
  cache (last good fetch, in SQLite) → static (built-in list per
  provider). Responses carry `source: live|cache|static` so the UI can
  say "cached list, endpoint down". Providers with `allowCustomModel`
  use free input + datalist.
- **Per-chat override**: `provider`/`model` columns on the chat row;
  empty = global default. A broken override (provider without key,
  model gone) degrades silently to the global default, never an error.
- **Mid-chat model switch**: the conversation is preserved — only the
  model adapter/session is rebuilt, never the history; the switch shows
  as a system bubble in the chat (client-side, NEVER sent to the model
  — chat override is UI state, not a conversation turn).
- **The global default is never empty**: if the default provider's key
  is deleted/disabled, the next configured provider is elected (or an
  explicit warning). An empty slot silently breaks everything that
  resolves "the default" (restore, title, voice) while chats look fine.
- **Endpoints**: `GET /v1/providers` (definitions + hasKey +
  defaultModel, no secrets), `PUT|DELETE /v1/providers/:id/key`,
  `POST /v1/providers/:id/test` (the validation completion),
  `GET /v1/models?provider=<id>` (3-layer catalog). `/model` accepts
  provider + model.
- **Chat Model and Service Model, one pair PER PROVIDER** (corrected
  07/08, built 1.60). The Chat Model is what the user talks to; the Service
  Model is what Pop Agent uses for its own work — naming a conversation,
  summarizing, tidying a voice transcript. It used to be one global setting,
  which was mono-provider thinking: a stored value is a *model id*, and a
  model id only means something inside one provider's catalogue. An install
  whose service model said `moonshotai/kimi-k3` asked OpenAI for a model
  OpenAI has never heard of the moment a chat ran there.
  - Stored beside the credential, per provider: `PUT
    /v1/providers/:id/service-model`, and a picker on the provider's card.
  - **Empty means "follow this provider's Chat Model"** — a fallback, not a
    value copied at setup. A copy is a second thing to keep in sync: change
    the chat model six months later and the copy still names the model you
    left behind, which for a custom endpoint may no longer be served at all.
    Picking the chat model again is what clears the override.
  - **Resolution**: a service task inherits the provider of whatever it
    serves — a title takes its chat's — and a job with no parent chat takes
    the head of the priority list. `resolveServiceModel(context)` and
    `resolveServiceChain(context)` on `ProviderService`; no consumer reads a
    global setting any more.
  - **Failover**: a service task walks the same chain a run does (§15 fase
    2). It tries every remaining provider rather than consulting
    `shouldFailOver`, and that difference is deliberate: that predicate
    reads a status code and the HTTP gateway does not carry one. Given the
    choice between guessing a class from prose and spending one more very
    small call, it spends the call.
  - The `voiceCleanupModel` override in Settings still wins where set, and
    applies to the FIRST chain entry only — carrying a model id down the
    chain would ask the fallback provider for a model it never heard of,
    which is the bug this whole correction removes.

### Subscription OAuth (fase 1.5)

- **Subscription auth rides pi's own login flows** — `openai-codex`
  (ChatGPT Plus/Pro) and `github-copilot` (Copilot seat). Pop Agent never
  reimplements an OAuth dance: `ModelRuntime.login` runs the flow and
  persists the credential into Pop Agent's own auth file
  (`POP_AGENT_DATA_DIR/pi-auth.json`); refresh happens inside pi per
  request. No key exists anywhere for these providers.
- **One interactive flow at a time**, server-side
  (`OAuthFlowService`): `POST /v1/providers/:id/oauth/start` begins it
  (starting a new flow cancels the previous), `GET .../oauth/state` is
  the transcript the browser polls (~2 s), `POST .../oauth/input`
  answers the flow's one pending question, `POST .../oauth/cancel`
  aborts, `POST .../oauth/logout` disconnects (pi `logout`). A flow
  nobody finishes times out after 10 minutes.
- **No token material ever leaves the server**: the state carries only
  display events (info / auth_url / device_code / progress) and the
  pending prompt; credentials go from the flow straight into pi's
  store. The wire shapes are copied field-by-field, never spread.
- **Subscription allowance belongs to its provider card.** Settings → Model →
  OpenAI subscription reads the provider's rolling usage windows and reset
  times through `GET /v1/providers/:id/subscription-usage`; it does not create
  another total in Settings → Usage. The engine asks pi for fresh OAuth auth
  first, then calls OpenAI's Codex usage endpoint. Only plan, percentages and
  reset clocks cross the infrastructure boundary — never email, account id or
  tokens. Failure hides the optional row rather than breaking Model settings.
- **Status/resolve semantics**: for an oauth definition `configured`
  = "the engine holds a credential" (`hasConfiguredAuth`), reported as
  `source: "oauth"`; resolve treats a signed-in subscription exactly
  like a stored key when electing the pair; test uses pi `checkAuth`
  instead of the paid HTTP probe; the model catalog answers from pi's
  built-in list (no gateway, keyless). Session open for an oauth
  provider must not demand an API key.
- **The auth file is the truth, not the snapshot.** pi's refresh
  (post-login bookkeeping: remote catalogs, availability) is best
  effort and may stall on the network, and its internal snapshot only
  moves when that bookkeeping finishes -- so every Pop Agent decision
  about "is there a credential" (`providerLogin`, `hasProviderAuth`,
  the authenticated-runtime door) reads `pi-auth.json` directly, and
  `providerLogin` resolves the moment the credential file lands,
  letting pi's bookkeeping run in the background. To keep that
  bookkeeping cheap and non-blocking, the service runs with
  `PI_OFFLINE=1` (catalog updates ride pi package upgrades instead).
- **The card outlives the page.** Signing in means leaving for the
  provider and coming back, and the way back is usually a fresh mount:
  a new tab, a reload, the PWA resumed from the background. The card
  therefore asks for the flow state on mount and adopts a running flow,
  instead of only knowing about flows it started itself.
- **The method choice is Pop Agent's words, not pi's.** pi offers a
  subscription two ways and calls the browser redirect "(default)" --
  but that redirect targets `localhost:1455` on the machine doing the
  browsing, which on a self-hosted install is not the machine running
  Pop Agent, so it can only end in a URL copied back by hand. The card
  relabels the two known methods (`device_code`, `browser`) itself and
  puts the code one -- no callback, works from any device -- first.
  Methods pi may add later render unrelabelled, as they arrive.
- **The redirect path is three steps, each said once**: open and
  approve, expect a page that does not load, paste that page's address.
  The warning comes *before* the input, because a user who meets the
  failed page unwarned reads the whole sign-in as broken and stops
  there. The steps carry the sign-in link, so the transcript drops its
  duplicate row, and the input uses Pop Agent's own placeholder -- pi's is
  the loopback URL itself, which reads like something to type.

### Multi-provider (fase 2 — automatic fallback)

- **The priority list is the only lever** (settings key
  `provider.order`, ids in order, #1 first). The list the user edits IS
  the failover order, and its head IS the global default: after every
  edit `electDefault` writes the first *usable* entry back as
  `defaultProvider`, so the numbered list can never say one thing while
  new chats do another. There is no separate "default provider"
  control. Providers absent from a saved list keep a position at the
  tail — a provider added later is never orphaned outside the chain —
  and unknown ids are dropped rather than stored. Routes:
  `PUT /v1/providers/order` (whole list, never a move).
- **A per-provider on/off switch** (settings key `provider.disabled`,
  `PUT /v1/providers/:id/enabled`). Off means out of the chain
  entirely, even for a chat that names the provider: the run falls
  through to the next candidate instead of failing. Switching off the
  head hands the default to the next usable entry; with nothing usable
  the current default is left alone, because an empty slot breaks more
  than a stale one.
- **The chain**: a run's failover chain = chat override (when usable) →
  the priority list, in order, one entry per provider
  (`ProviderService.resolveChain`). The global default gets NO entry of
  its own — it used to sit ahead of the list, a hidden #0 nobody could
  see or move, so an install whose stored default was a dead endpoint
  kept starting there however the list was arranged. The default is
  derived from the list, never a second opinion about order; it still
  decides the MODEL for its own provider (the list says who answers,
  the model picker says with what). Only usable providers (key stored
  or subscription signed in, and switched on) take a place. An install
  that never edited the list gets its existing default as #1, so
  removing the old control moved nobody's answers. With nothing usable
  it degrades to the head of the list, so the run still fails with the
  error that points at Settings.
- **Attempt lifetime belongs to pi/provider**: Pop Agent adds no competing
  silence timeout around `AgentBridge.run`. pi's configured retry policy handles
  transient failures and only its final outcome reaches the host bridge; the
  provider transport owns request deadlines. This keeps slow reasoning and long
  tool turns under the same policy as a native pi session instead of aborting a
  healthy attempt at an arbitrary host-side minute.
- **Error classification is TYPED** (`shouldFailOver`, application
  layer): by code and HTTP status, never substring-only. Fail-forward:
  401/402/403/404/408/429/5xx, `network_error` (transport: ECONN*,
  TLS, fetch failed…), `provider_not_configured`. Never: 400, the
  user's Stop (`aborted`), `turn_tainted`. Anything unclassifiable
  stays put. The bridge supplies the typing: it parses the status out
  of the code-shaped places providers put it and tags transport
  failures. Context overflow keeps its own path (§7: compact + retry
  same provider once, inside the bridge); only a failover-class error
  on the retry moves on.
- **Mid-stream failure does NOT fail over** (tokens already rendered)
  but still penalizes the provider; the run fails in place with the
  persisted system mark.
- **Advisory cooldown** (`ProviderCooldown`, in-memory, escalating —
  1.73): a penalized provider is skipped by the next chains — unless
  every candidate is penalized, in which case the full chain is used
  anyway. The wait lengthens with each consecutive strike (1 min →
  5 → 15 → 60); a flat 5 minutes both forgave a provider that was
  down for an hour too early and kept punishing a hiccup too long.
  Saving a key, completing a sign-in, a green connection test or a
  successful run forgives the provider; a restart forgives everyone.
- **Failover is LOUD**: a persisted system message in the chat
  ("Answer retried via X after Y failed (code).") plus one journal
  line (`pop fallback: chat=… from=… to=… code=…`). Every billed
  attempt books its own `llm_runs` row (failover attempts under
  `<runId>-f<n>`), so the accounting shows what each provider really
  charged.
- **A retry never replays the user's prompt** (1.73): before a
  failover hop or an overflow retry, the bridge rewinds the pi session
  to before the user message (`SessionManager.branch` on the entry
  id) and resyncs the agent's history — the next provider answers the
  message once, not twice in the saved context.
- **Thinking and tool calls gate the failover** (1.73): a run that
  already streamed either never retries on the next provider —
  re-executing side effects is worse than failing in place. An
  abandoned attempt still books whatever usage settles late, and its
  session is hard-forgotten (`discardSession`) so it is never
  re-prompted into a shared context.
- **Auth-class failures surface** (1.73): a refusal the cooldown
  classifies as auth stamps `authErrorAt` on the provider (DTO +
  "sign in again" badge in Settings), cleared by a fresh key, a fresh
  sign-in or a green connection test.
- **Background work bills like chat work** (1.73): `completeAsService`
  records a `llm_runs` row per completion (`kind: 'service'`,
  migration 032; `chatId` empty by convention), with the provider's
  reported usage and zero cost for a subscription.
- Still future: a user-editable priority order (today the order is the
  definition list with the default first).

### Updates — two channels, one discipline

Both channels: manual always available, auto opt-in (default OFF, no
unasked network calls), versions pinned exactly, a recorded
**last-known-good**, and a **post-update smoke gate** before the new
version is accepted.

**pi channel** (npm, the sensitive one — a pi release can break Pop Agent):

1. Daily semver check against npm (when auto-check is on); SSE banner;
   install = `npm install @earendil-works/pi-coding-agent@<v> --save-exact`
   after draining running runs.
2. Before activating: run the **update gate** — the smoke suite against
   the new version (in-memory session + fake provider: create session,
   run a turn, event shapes, custom-tool registration, abort) plus an SDK
   contract check (every API Pop Agent imports still exists). Zero tokens.
3. Gate passes → version activates and becomes last-known-good. Gate
   fails (or the bridge fails to boot) → **automatic rollback** to
   last-known-good, **auto-update disables itself**, and the user is
   notified (banner + SSE; push when v0.2 lands): "pi X broke Pop Agent,
   rolled back to Y, auto-update off until you re-enable it."
4. **Probation**: a version that passes the gate stays on probation for
   24h; if the pi bridge crashes repeatedly (threshold N) during
   probation → same rollback + disable + notify path.
5. `POST /v1/update/apply {version}` accepts any exact version = manual
   pin or manual rollback.

**Pop Agent channel** (its own repo):

- Settings → Updates has a "Pop Agent" card: checks the repo's release tags
  and distinguishes the **boot commit** from checkout `HEAD`. Fetch/install/
  gate still happens before activation. A clean committed checkout can be
  handed to the safe deployment coordinator: it refuses new runs, drains live
  conversations and tasks, then launches a transient systemd supervisor outside
  the server's cgroup. The supervisor restarts, health-checks, records
  last-known-good and, on failure, preserves the candidate under a
  `failed-update-*` ref, restores last-known-good, rebuilds and restarts again.
- Operator CLI: `popman update` does the same from the server shell.
- The terminal chat client's `pop update` only reinstalls that client from its
  selected server; it never creates a chat or invokes an LLM.
- Plain `git pull && npm ci && npm run build && restart` remains
  documented for local-on users.

**PWA client freshness** (the installed frontend, distinct from the two
channels above):

- An installed PWA only re-checks its service worker on navigation, so the
  client drives the check itself: on a **device-chosen interval**
  (Settings → Appearance → App updates, default **10 minutes**; the shipped
  factory default drops to **once a day**), on `visibilitychange → visible`
  when the app is resumed, and on a manual **"Check now"**. The interval is
  device-scoped in `localStorage`, never sent to the server.
- The registration lives in one module (`web/src/services/pwa-update.ts`);
  `registerSW` runs exactly once. A found update raises the reload banner
  (`registerType: 'prompt'` — never a silent swap).
- The server serves `sw.js` and the HTML shell with `Cache-Control:
  no-cache` (always revalidate) and only the hashed `/assets/*` with
  `immutable`, so a heuristic cache can never pin a stale worker or shell.

## 16. Backup and restore

- Automatic snapshots: tar.gz of `POP_AGENT_DATA_DIR` (minus `secret.key`,
  minus `backups/` itself), consistent SQLite copy via the backup API
  (never a raw copy of a hot WAL db). Retention: daily × 7 + weekly × 4
  (tunable). Settings → Backup lists snapshots for download.
- **Restore only with the server stopped**: `pop restore <file>`. Never
  over a running server. Restore UI: maybe later.

## 17. Two CLIs

Not one command with a mode: `pop` and `popman` are separate programs
with separate audiences, and the split is what keeps the everyday one
installable. Full design in `docs/cli.md`.

**`pop`** — the chat client. Ships as `@pop-agent/cli`, installs on any
machine (`npm i -g <server>/cli-X.Y.Z.tgz`, served by the server itself),
and carries no server code: no `better-sqlite3`, no `argon2`, nothing
that knows where `secret.key` lives. The package also carries **Pop Local
Access (PLA)**, an internal library shared by interactive CLI and the Pop
Desktop host's hidden `--managed-local-access` child mode. PLA has no UI,
install, version or credentials of its own and never creates a chat or invokes
an LLM.

PLA opens authenticated WSS `/v1/local-tools`; after two pre-attach upgrade
failures with ordinary authenticated HTTPS still healthy, it falls back to
the long-poll `/v1/local-tools/connections/*` transport. Both use the same
Bearer session, application frames, limits, heartbeat, cancellation and
connection id. Pop Desktop passes `{url, token, role}` by stdin, keeps that
pipe open for renewed web sessions, and launches the exact detected Node + CLI
entry without a shell. The Manager installs and diagnoses those components but
does not own the runtime connection.

An interactive message explicitly names its PLA connection. A Desktop-originated
message without one uses that Desktop's single `managed-default` connection
when attached; ordinary web/PWA messages never inherit it implicitly. Otherwise
the run honestly receives no local tools. An explicit dead id is rejected
before a run starts and never falls back to another machine. Disconnects fail
pending calls and never replay non-idempotent work. Logout, password recovery,
epoch change and token expiry close attached local access.

    pop | pop "question" | pop -p "…"
    pop login | logout | servers | chats | update
    pop --chat <id>
    pop --version

Leaving the interactive client through Ctrl+C, `/quit` or `/exit` prints
`Bye!` and, when the conversation has a server id, a ready-to-paste
`pop --chat <id>` continuation command. The whole farewell block is grey.
Before the first message creates the chat, only `Bye!` is printed.

`pop --version` is entirely offline: it prints only the installed semantic
version and exits without reading a profile, opening PLA, contacting a server
or creating a chat. Desktop managers may use it for safe discovery.

A Windows machine can bootstrap from its own server without already having
Node or knowing the current CLI version:

    powershell -c "irm https://<server>/install.ps1 | iex"

The public, `no-store` script derives `<server>` from its request origin, embeds
the running global version, requires 64-bit Windows, accepts Node `>=22.19.0`,
and installs Node LTS through `winget` only when necessary. It then invokes the
Windows `npm.cmd` launcher directly, installs the immutable same-origin CLI
tarball, verifies `pop --version`, and prints `pop login <server>`. It contains
no session, credential or user data. CLI self-update likewise selects `npm.cmd`
on Windows and `npm` elsewhere; neither path uses a shell.

**`popman`** — the operator's tool. Ships with the server, runs only
there, and is the only thing that touches systemd, the SQLite file and
the backups directory.

    popman start | stop | restart | status
    popman backup | backups | restore <name>
    popman reset-password
    popman update

`reset-password` covers "forgot the password AND the recovery key" for
whoever has shell: no proof is asked for, because owning the machine is
already the proof, which is also why it exists nowhere else — an HTTP
route with the same power would be a password reset for anyone who found
the URL. It bumps the session epoch, so every signed-in device is signed
out, and prints a new recovery key once.

`access-list` is named in §18 and **not built**: there is no IP access
list to manage yet. `popman access-list` says so rather than pretending.

**Client/server versions.** Root `VERSION` is the single manually edited global
release version. A TypeScript consistency check runs before typecheck, build and
the full gate; it rejects drift in package manifests, lockfile workspace entries,
the CLI handshake, packed CLI metadata and any published Pop Desktop manifest.
The macOS native repository must receive this same file through
`POP_AGENT_VERSION_FILE`; its build and packaging stop when the local version
differs. The desktop download route also refuses a manifest whose version differs
from the running server's global version.

The server holds its own version and the
oldest client it accepts; the local-tools attach compares them.
Compatible is silent, merely behind prints one line with the install
command, and below the minimum is refused with that command. The minimum
is set by hand and moves only when the wire changes.

### 17.1 Pop Desktop distribution

Pop Desktop is the existing PWA inside a separately installed, minimal macOS
`WKWebView` host. The host loads this server's HTTPS origin directly: no copied
React build or localhost proxy. A narrowly scoped main-frame, same-origin bridge
synchronizes only the PWA bearer session; it exposes no filesystem, shell or
native command API. The host detects a compatible local Node and Pop CLI, then
supervises the CLI's PLA child for the Desktop lifetime. Its release version
follows the global Pop Agent version (`0.2.12` here); normal PWA changes do not
require a host release, but the next native host change uses the then-current
global version.

The authenticated Manager-only contract is:

- `GET /v1/desktop/release` — `{version, platform:'darwin', arch:'arm64', sha256, size, downloadPath}`;
- `GET /v1/desktop/package/pop-desktop-X.Y.Z-darwin-arm64.zip` — the exact immutable signed bundle.

The path is same-origin and exact, the normal Bearer session guards both calls,
and the package contains no token or user data. The server reads only
`desktop/pack/release.json` and the file it names. A malformed manifest, absent
package or size mismatch is a 404. `desktop/pack/` is release output, not source.
Different bytes require a new host semver and URL.

## 18. Production exposure

- Bind `127.0.0.1` by default. HTTPS has **two supported shapes**, and
  which one applies depends on whether the machine can accept inbound
  connections at all:
  - **(a) Public VPS — the product's default.** Reverse proxy with Let's
    Encrypt (Caddy recommended, example Caddyfile in repo), your own
    domain, ports 80 and 443 reachable.
  - **(b) A machine that cannot accept inbound traffic** — behind CGNAT,
    or on a consumer line that blocks 80 and 443 (the maintainer's home
    connection blocks both). HTTP-01 cannot complete and the port cannot
    be served, so (a) is simply unavailable. Use **`tailscale serve`**: a
    valid certificate on a `*.ts.net` name, reachable only inside the
    tailnet, with no port opened anywhere — enough for an installable
    PWA, since it is a secure context. `tailscale funnel` publishes the
    same thing to the internet when that is wanted. This is how the test
    server is exposed.
- Login protection: rate limit (10/min/IP) + progressive lockout + **IP
  access list** (CIDR blocks, managed in Settings and via CLI). If you
  lock yourself out: `pop access-list clean` over SSH.
- Control plane `GET /v1/ax`: describes the app for agents (route map,
  error contract, action catalog with risk levels), own X-API-Key separate
  from user sessions, OFF by default. `tools/smoke.ts` starts the server as its
  own process with a temp `POP_AGENT_DATA_DIR` on an ephemeral port and drives
  it over HTTP end to end — health, first-run state, setup, the session
  guard, a settings roundtrip, a password change that drops old tokens,
  recovery spending its key, sign out others, and the built frontend being
  served. It runs in the gate and in CI; Phase 2 extends the same file
  with the chat over a fake provider.

## 19. Versioning and roadmap

- Annotated semver tags (`v0.1.0`) + CHANGELOG.
- **v0.1**: chat + streaming + auth + SQLite + memory + notes + web_fetch.
- **v0.2**: voice, attachments, backup UI, Web Push, skills mini-RAG,
  passkey/biometric unlock (§9).
- Later: web_search, Playwright, Mermaid/KaTeX, custom themes, restore UI,
  i18n PT-BR.

## 20. Working conventions

- Flow: agent codes, gate green → conventional commit straight to main.
  The maintainer tests visually; the agent tests through `/v1/ax` + smoke.
  A dedicated home Linux box will serve as a real test server the agent
  logs into (details when it's set up).
- **Continuous execution (decided 31/07/2026)**: the remaining phases run
  in sequence with **no manual acceptance between them**. The agent tests
  each block itself — full gate plus a live check against the dev server
  in the browser — and calls the maintainer once, at the end, with a
  numeric summary and an iPhone checklist. Anything that can only be
  validated on the device (passkey, push with the PWA closed, real-mic
  recording, PWA reinstall) goes on that checklist, never blocks the flow.
  Small product/technical decisions are the agent's to make: decide,
  record here with a version bump, move on.
- Scope evolves in batches of ~20 questions in the maintainer's notes
  (Portuguese, outside the repo). When an answer signals a concept wasn't
  clear, stop and explain before deciding.
- **Dev happens on the test server, not on the maintainer's machines**:
  the agent connects over SSH to `ubuntu-home` (Ubuntu Server 26.04, home
  LAN / tailnet), codes in the clone at `~/dev/pop-agent`, runs the gate, the
  dev server and the smoke there, and pushes to GitHub from there. The
  Windows ThinkPad is only the terminal (and holds a read-only mirror
  clone); the Mac has npm blocked by corporate policy. UI testing: the
  agent drives a browser (Chrome DevTools) against the server's URL —
  same interface the maintainer uses. Production target: any Linux with
  systemd + Node 22 (`npm run build` + systemd unit example in repo).
  Docker: maybe later, never required.
- The test server runs the dev build under **systemd**
  (`deploy/pop-agent-service.service`: sources through tsx, absolute `ExecStart`
  because systemd's boot PATH is minimal), so the tailnet URL answers
  after a reboot with nobody logged in. The production unit points at the
  compiled `dist/` instead.
- Gate order is lint → typecheck → **build** → test → smoke: the server
  serves the built frontend, so both the tests and the smoke need it to
  exist first.
- Verify-at-coding list: pi RPC mode as crash-isolation plan B; SDK
  per-session skill scoping (§8); pi's abort behavior on running bash
  (§5); pi's native auto-compaction (§7); aw's voice-to-composer UX (§14).

## 21. Background tasks (`application/tasks/`)

- A **task** is a prompt with a schedule: the third tab of the sidebar,
  next to Chats and Files. Two kinds and no more — `once` (runs at the
  next tick, then switches itself off) and `interval` (every N minutes,
  forever). A cron expression is a language; this is a personal agent.
- Table `tasks` (migration 017): title, prompt, `schedule_kind`,
  `interval_minutes`, `next_run_at`, `enabled`, `created_at`, and the last
  run's `last_run_at` / `last_status` / `last_chat_id`; migration 018 adds
  `notify_on_finish` (default 1) and `archive_chat` (default 0). Times are epoch
  milliseconds here, unlike the ISO strings of the chat tables: everything
  about a schedule is arithmetic on what the clock port returns. The wire
  DTO converts back to ISO, like every other timestamp the API hands out.
- The **scheduler** lives in `application/`, with the clock AND the timer
  injected (`ports/timer.ts`), so the whole thing is unit-tested without a
  wall-clock second passing. It ticks every 30s, wired in main.ts after the
  server is listening.
- **Serialised, FIFO, never two at once.** Each due task is appended to a
  single queue worked one at a time. A task run is a full agent turn with a
  workspace and a process group behind it; two racing on a small VPS is how
  a personal server falls over. The global run ceiling would not help — it
  counts chats, and every task run opens a new one.
- Each run: open a fresh chat, **rename it to the task's title through the
  manual-rename path** (which switches `auto_title` off, so the service model
  will never rewrite a name chosen for the task — §14), post the prompt as a
  user message,
  and run it through the normal `RunService`. Failover, context compaction,
  usage accounting and persisted error messages all apply, and the result is
  readable as an ordinary conversation.
- On finish: `last_run_at`, `last_status` (`ok` or the failure code),
  `last_chat_id`; an interval task is parked one interval **from when it
  finished**, not from when it was due, so a task slower than its own
  interval cannot queue up behind itself; a `once` task is switched off.
  One journal line per run.
- **Two switches for what a finished run does to the rest of the app**, both
  per task, because the defaults that suit a once-a-day task are exactly
  wrong for one that runs every ten minutes:
  - `notifyOnFinish` (default on) — the finished-run push (§14). Off is
    passed down as `RunService.startRun(..., { notify: false })`, which
    silences **only** the push: `notifyDone` still fires, so the run is
    still counted for health. A quiet task is not an invisible one.
  - `archiveChat` (default off) — the run's conversation is archived the
    moment the run ends, so a frequent task stops burying the sidebar under
    its own output. The chat is untouched otherwise and `last_chat_id`
    still links to it. Archiving is wrapped in its own catch: where a
    conversation sits must never rewrite the run's recorded status.
- **A failing task never crashes or stalls the scheduler.** The catch is
  total: the failure becomes the run's status and the queue moves on. A
  task already running is not queued again by the next tick, and a task
  deleted while it waits is skipped.
- `RunService.whenRunEnds(runId)` is how the scheduler learns the outcome:
  an SSE sink is a broadcast, not an answer to one question. Outcomes for
  runs nobody asked about yet are remembered briefly and bounded.
- Routes (all session-guarded): `GET|POST /v1/tasks`,
  `GET|PATCH|DELETE /v1/tasks/:id`, `POST /v1/tasks/:id/run-now` (202 —
  queued, never inline), `POST /v1/tasks/:id/toggle`. Bodies are strict
  Zod; an interval with no minutes is a 400. New error code:
  `task_not_found`.
- Any change to the schedule, and any switch back on, **re-parks**
  `next_run_at` from now: an edit from "every 6 hours" to "every 5 minutes"
  must not still wait six hours, and a task switched on after a month off
  must not fire the same second.
- UI: the list is the sidebar (like Chats, so on a phone it *is* the
  screen) — title, human-readable schedule, next run, the enabled switch,
  and the last status linking to the conversation it happened in; Run now
  and Delete-with-confirm in the row menu. Create/edit is a **full-screen
  route**, never a drawer (§14), with Save and Cancel.
- **Internal maintenance** (`ports/maintenance-job.ts`) rides the same
  tick rather than owning timers of its own. A maintenance job is not a
  task: no row, no chat, no agent tool, invisible in the UI.


### The orphan sweep

- A **maintenance job**, not a task: no row, no chat, no agent tool, invisible
  in the UI. It rides the scheduler's tick on a daily cadence, and runs on the
  first tick after boot so a machine that reboots every night still sweeps.
- Two targets, both deliberately narrow:
  - `POP_AGENT_WORKSPACE/attachments/<chatId>/` whose chat is no longer in the
    database. A chat deleted through the API already takes its folder with it
    (§6); this catches what a crash, a restore or a hand-edited database left.
  - Scratch files sitting **directly** in the workspace root, older than thirty
    days, and only with an extension the agent is known to leave behind:
    `.png`, `.yaml`, `.mjs`.
- The list of what it must never do is longer than what it does: never the
  attachments of a living chat, never the database, never a directory in the
  workspace root (that is someone's project), never anything outside
  `POP_AGENT_WORKSPACE`, never a symlink. **Session history is forever** — a sweep
  only ever removes files *derived* from it, never a message, a chat or a
  title. Deletion failures are swallowed: a file already gone is the goal.
- One journal line per sweep, with the counts, even when both are zero — a
  silent job is a job nobody can tell is alive.

## Changelog

- 1.88 (2026-08-13): **Windows can bootstrap the CLI from its own server (§17).**
  Public `GET /install.ps1` derives the personal server origin from the request,
  installs a compatible Node LTS through winget when absent, invokes `npm.cmd`,
  installs the server's exact immutable CLI package and leaves the exact login
  command. CLI self-update now also selects `npm.cmd` on Windows. The changed
  server and CLI package ship as 0.2.16.
- 1.87 (2026-08-12): **Composer focus never changes horizontal containment
  (§14).** The conversation pane and viewport now clip their horizontal axis,
  the composer constrains its flex chain, and its textarea explicitly suppresses
  horizontal overflow in both idle and focused states.
- 1.86 (2026-08-12): **Chat titles wait for the conversation (§14).** A new
  conversation keeps its deterministic `Chat N` name through the first two
  user messages. After the third, one service-model call creates a short title
  and summary; there is no first-message word picker, periodic regeneration or
  deterministic rename when the LLM is unavailable.
- 1.85 (2026-08-12): **The app viewport cannot become a horizontal scroller
  (§14).** Horizontal containment now reaches `html`, `body` and `#root`, not
  only the transcript, closing the outer overflow that focus could shift out of
  view while leaving bounded code and table scrolling intact.
- 1.84 (2026-08-12): **Horizontal overflow stays inside its content (§14).**
  The chat transcript now clips its horizontal axis and constrains every flex
  layer; ordinary long tokens wrap, while code and tables keep bounded local
  horizontal scrolling. Native vertical touch scrolling is unchanged.
- 1.83 (2026-08-12): **The CLI farewell is quiet grey (§17).** The complete
  `Bye!` and continuation-command block now uses the terminal's grey ANSI
  colour. The changed package ships as 0.2.9.
- 1.82 (2026-08-12): **The CLI leaves a continuation command (§17).** Ctrl+C,
  `/quit` and `/exit` now print the current `pop --chat <id>` command after the
  TUI closes; a not-yet-created conversation only says goodbye. The CLI ships
  this as 0.2.8.
- 1.81 (2026-08-11): **Pop Local Access replaces the user-facing hands concept (§17).**
  CLI and Desktop share one internal TypeScript executor. WSS `/v1/local-tools`
  has an authenticated HTTPS long-poll fallback, managed-default routing makes
  Desktop local tools available to PWA messages, and session expiry/revocation,
  cancellation, process-tree cleanup, transport limits and headless IPC are
  explicit. The breaking wire ships as 0.2.6.

- 1.78 (2026-08-11): **CLI hands reconnect instead of disappearing silently (§17).**
  A dropped hands WebSocket leaves chat running, emits one visible reconnecting
  line and retries with bounded exponential backoff; reattach gives subsequent
  messages the new hands id. Explicit shutdown cancels retries. The CLI already
  identifies every request as `cli` + platform; that metadata contract is
  unchanged.
- 1.77 (2026-08-09): **Pending-message wording reflects delivery (§14).** A
  steering bubble carries the quiet `Sending:` status because it is entering
  the current run; the explicit follow-up strip says `Queued:` because it waits
  until that run ends. Neither label exposes the internal steering vocabulary.
- 1.76 (2026-08-09): **Steering stays in the transcript (§14).** An ordinary
  message sent during a live answer appears once as a normal user bubble after
  that answer; the redundant “Guiding this run” strip above the composer is
  gone. Native steering, persistence and delivery order are unchanged, while
  the explicit `/queue` follow-up keeps its editable queue strip.
- 1.75 (2026-08-09): **OpenAI subscription allowance on its own provider card
  (§15).** Settings → Model → OpenAI subscription now shows each rolling Codex
  usage percentage as a progress bar, its reset time and the plan. The guarded
  provider route returns only those allowance fields; the engine refreshes the
  OAuth credential through pi before reading OpenAI, and strips account
  identity and token material at the infrastructure boundary.
- 1.74 (2026-08-08): **The built-in roster review (§8).** Seventeen shipped
  skills became seven: the generic text ones (writing, summary, translation,
  explanation, brainstorm, math, planning) only added routing noise against
  the user's own skills; the survivors merge into `pop-agent-manual`
  (pinned manual, absorbing privacy), `pop-agent-codebase` (the generated
  self-map), `web-research` and `code-work` (rewritten against the real
  tools). A boot sweep removes built-ins that left the roster — deleted when
  pristine, promoted to `user` when edited. And every skill, built-ins
  included, can now be switched off (`enabled`, routed and pinned sets both
  respect it), exposed in the sidebar with a source filter (All / Personal /
  Auto / Pending / Built-in) whose button carries the pending count.
- 1.73 (2026-08-08): **The provider review fixes (§15).** Nineteen findings
  from a full read of the provider surface, closed in three lanes.
  Provider core: deleting or clearing the active default's key re-elects the
  head; `completeAsService` now penalizes a refused provider and forgives a
  recovered one (it silently bypassed the cooldown before); the model catalog
  cache invalidates when the account or endpoint changes instead of serving
  a stale list; a green connection test forgives the cooldown; auth failures
  surface as `authErrorAt` on the status DTO; the cooldown escalates
  (1 → 5 → 15 → 60 min) instead of a flat 5; the order route validates with
  `schemaError` like its siblings and caps at registry size; the legacy
  `custom` alias follows the canonical default. Completion path: retries
  rewind the pi session instead of replaying the user prompt; thinking or
  tool output gates the failover; an abandoned attempt's late usage is
  booked and its session discarded; a success clears the cooldown; gateway
  `complete` returns usage so background work lands in `llm_runs`
  (`kind: 'service'`, migration 032). Interface: negative OpenRouter
  balances render as `-$0.10`; credit lookups are cached per provider list
  load; the enable/disable switch is back on the provider card; an
  auth-error badge offers the sign-in again.
- 1.72 (2026-08-08): **The auto-skill review fixes (§8).** Five findings from
  a read of the router + auto-skill code, all closed: (1) the candidate
  scrubber now catches unlabeled tokens by shape (`sk-…`, `ghp_…`, `AKIA…`,
  JWTs, private-key blocks) — a bare pasted key no longer survives into a
  skill body that gets replayed into future prompts; (2) `asksForSkill`
  ignores a phrase preceded by a negation word — "não cria uma skill" is not
  a request; (3) with fewer than five measured skills the semantic leg uses
  `max(floor, 0.80)` (the noise band's p90) instead of the bare 0.75 floor
  that sits inside the band; (4) a revision proposed on a slug collision
  records the measured cosine or none at all — never a hardcoded 1 — and
  `skill_revisions.similarity` is nullable (migration 031); (5) the
  distiller's tick finds chats with new messages in one query
  (`lastMessageIds`) instead of reading every conversation's tail.
- 1.71 (2026-08-08): **One completion path, for every provider (§15).** A
  subscription has no API key to hand an HTTP gateway, so everything built on
  `gateway.complete` quietly excluded it: `completeAsService` required a
  gateway *and* a key, and skipped the provider otherwise. Chat worked, because
  chat goes through the engine. Nothing else did. With the ChatGPT subscription
  first in the chain, every title, every distilled skill and every cleaned-up
  transcription fell through it to the paid provider behind -- silently, and
  visibly enough that Settings still offered the subscription a Service Model
  that could never run. It only looked healthy because something paid was
  always there to absorb the fall-through.
  So the engine gets a completion of its own: `AgentBridge.complete`, over
  pi's `completeSimple`, resolved through the same `authenticatedRuntime` that
  already answers for an API key and a subscription alike. `completeAsService`
  takes the gateway when there is a usable key and the engine otherwise, and
  the connection test does the same -- which means a subscription is now tested
  by a real, timed round trip like everyone else. That reverses 04/08, which
  refused to print a millisecond figure for a trip that never happened: the
  objection was to inventing the number, so the trip is made instead. A
  subscription is not billed per token; it costs a moment.
  `checkProviderAuth` went with it, from the port down to the fake: once the
  test makes a real request, a second way to ask "does this provider work?" is
  one way too many (Vinicius, 08/08: "nao tem sentido ter 2 caminhos pra mesma
  coisa").

- 1.70 (2026-08-08): **The sign-in card reconciles against the provider's
  status when its poll cannot answer (§15).** The ChatGPT subscription signed
  in -- the credential was on disk at 16:02:33, complete -- and the card sat on
  "Waiting for the provider…" until it was reloaded. The transcript poll
  swallowed every failure (`.catch(() => undefined)`), so one refused request
  left the card waiting forever on a sign-in that had already landed: no error,
  no retry limit, no way out. Three unrelated faults end in that same wrong
  answer -- the service restarting takes the in-memory flow with it, a
  backgrounded PWA freezes its timer, one fetch loses the network.
  So the poll no longer owns the truth alone. After two consecutive misses the
  card asks the provider's own status instead (configured means the sign-in
  landed, the same news by another route), and it polls immediately on
  `visibilitychange` rather than waiting out another interval. The happy path
  was never broken and is now pinned by a test that had never existed: of the
  three added, it is the only one that passes against the old code.

- 1.69 (2026-08-08): **Popy is renamed Pop Agent, as a clean break.** The
  display name is `Pop Agent` — UI strings, PWA manifest, WebAuthn RP name,
  the agent's own system prompt and the self-knowledge skill. The slug is
  `pop-agent`: repo, npm packages (`pop-agent`, `@pop-agent/*`), data
  directory `~/.pop-agent`, database `pop-agent.db`, workspace
  `~/pop-agent-workspace`, systemd unit `pop-agent-service`, CLI profiles in
  `$XDG_CONFIG_HOME/pop-agent/`, env prefix `POP_AGENT_*`. The two binaries
  drop the project name and take the short form: `pop` (chat client) and
  `popman` (operator), so the thing typed all day stays two syllables.
  `POPY_AGENT` became `POP_AGENT_ENGINE` rather than `POP_AGENT_AGENT`; the
  wire field `popy` on `GET /v1/update/status` became `popAgent`.
  **No compatibility layer, on purpose** — no `POPY_*` fallback, no reading
  `~/.popy` when `~/.pop-agent` is absent. The instance is single-user and
  pre-release, so a shim would be permanent cost for one migration. The cost
  paid instead: the session token header is `x-pop-agent-token` and the
  browser keys are `pop-agent.*`, so every client re-authenticates once and
  loses its theme and drafts; the PWA must be re-added to the iPhone home
  screen to pick up the new name and push. Passkeys survive — they are
  anchored to the `rpId` (the domain), and only the display `RP_NAME`
  changed. The timing is deliberate: Docker (§18) and the Go client would
  each freeze another set of names.
  Not migrated, and left visibly stale: conversations, the memory document
  and the distilled auto-skills still say "Popy", because they are the
  user's content and rewriting them is not the rename's business.

- 1.68 (2026-08-08): **The dedup bars are measured, and the distiller may only
  revise its own work (§8).** Found by testing the 1.66 request path against
  the live instance: "vira skill" on a restart-the-service procedure produced a
  good skill, and it was filed as a revision of `self-change` at cosine 0.9017.
  Accepted it would have replaced an unrelated skill; refused it left the new
  one in a table with nothing on the Skills screen.
  So the 0.90 that §10 admitted was a guess got its measurement: 406 pairs of
  distinct vault skills against the 36 pairs of known duplicates. The cosine
  distributions **overlap** — 0.895 to 0.936 — so no cosine can separate them,
  and the answer is a second signal. Shared vocabulary does separate them, and
  `0.88 / 0.25` catches 32 of 36 duplicates while merging none of the 406.
  `tools/skill-dedup-calibrate.ts` is that measurement, kept.
  Verified live three times after the change: each request was picked up within
  a minute, each produced a pending skill, and each logged the neighbour it
  correctly declined to merge into — including `renovar-certificado-cloudflare-ssl`
  against `renovar-certificado-mikrotik-hex`, two certificate-renewal procedures
  at cosine 0.85 that share 2% of their words.
- 1.67 (2026-08-08): **`tools/live-skills.ts` loses its replay mode.** The
  `--offline` flag fed the loop a recorded answer so the router half could be
  exercised for free. It had been broken since 1.64 changed the answer format
  and the fixture was not changed with it: every offline run printed "nothing
  learned" and read as a finding about the distiller. Deleted rather than
  repaired (Vinicius, 08/08). The file exists because a fixture can agree with
  the code that wrote it and disagree with the code that reads it — which is
  exactly what the stale replay did — so a mode that passes without calling a
  model defeats the only thing it is for. The gate is where fixtures belong.
- 1.66 (2026-08-08): **Skills leave the conversation (§8).** Vinicius read a
  transcript where he was choosing a name for Pop Agent and got, turn after turn, a
  paragraph explaining why no skill was being created. The log says why:
  `skill-creator` was routed into nine of sixteen turns, every one at
  `lex=0.00` and cosine 0.79–0.84 — inside the e5 noise band this spec already
  documents — and its own procedure told the model to announce the decision.
  A skill whose trigger is a sentence should never have been reachable by
  meaning, and an internal check should never have had a voice.
  So fase (b) is withdrawn. `skill_write` is off the agent's hand, the
  `skill-creator` skill is out of the built-ins, and the system prompt says
  plainly that Pop Agent does not write skills and must not narrate the subject.
  The distiller is the only writer. An explicit "vira skill" survives as a
  **separate path**: matched by phrase list on the user's own messages, it
  makes that chat jump the queue, skip the idle wait, and forbids the empty
  answer — a request must not be able to lose, which a score always can.
- 1.65 (2026-08-08): **The dedup was comparing against a table the pending
  skills were missing from (§8).** Found by reading the instance, not the
  tests: `skills/auto/` held twelve skills and nine were the same procedure
  under nine invented slugs. The router filtered `pending` before it built
  the vector index, and the distiller's dedup reads that index — so every
  candidate was measured against a set its predecessors had never entered,
  and the 0.90 threshold never got a chance to fire. Only the slug leg ever
  caught anything, and a model naming its own skill never repeats a slug.
  The index now covers the whole vault and the filter moved to the
  selection; the distiller stores a candidate's vector when it writes the
  skill, because a job on a ten-minute timer cannot wait for a user message
  to index its own output.
  The load that exposed it was a scheduled task, hourly since 02/08: 153
  runs, 49 of the database's 55 chats, and three proposals that were the
  same observation three times. It stays hourly — it is the only thing
  generating enough distiller traffic to have found this, and it will be the
  thing that proves the fix. What it also revealed is that the router's
  entire observability record is 125 identical log lines, one query repeated:
  there is not yet real routing data to retune `0.90` or `z ≥ 2.1` from.
- 1.64 (2026-08-08): **The distillation format stops being JSON (§8).** Two
  more live runs, this time against the instance's real provider chain through
  `completeAsService`. The first version of `tools/live-skills.ts` called
  OpenRouter directly with a hardcoded model id, which bypassed the very
  Service Model resolution it existed to exercise -- and produced a wrong
  conclusion from an out-of-credit error on a provider this instance does not
  even reach first.
  Through the real chain the model answered well and the skill was still lost,
  twice. Once because the body held a `curl` line with
  `--data '{"purge_all":true}'`, whose unescaped quotes made a complete and
  plausible document invalid. Once because the model wrote `--- body` without
  the closing dashes, and an exact-match parser dropped a well-formed skill
  over it. Hence markers and lines, nothing escaped, markers matched loosely.
  The loop then ran end to end on `custom-8e4e682bfd / sabiazinho-4`: the skill
  was distilled and held pending, was **not** routed until approved, was
  selected first afterwards (`cos=0.81`) for a Portuguese question sharing none
  of its English words, and was archived by the collector.
- 1.63 (2026-08-08): **The auto-skill loop verified against a real model, and
  the bug that verification found (§8).** `tools/live-skills.ts` runs the whole
  loop on a throwaway database and vault — plant a conversation, distil it,
  approve what comes out, ask the router a question the skill should answer —
  and it is out of the gate because it spends money, like `live-check.ts`.
  The first run found that the distiller was silently discarding good skills.
  A reasoning model spends most of its token budget thinking and the JSON
  stopped mid-field; `JSON.parse` rejected the lot; the empty result read as
  "nothing to learn"; the watermark advanced. The conversation was gone for
  good and the skill with it. The parser now scans complete objects out of the
  array and reports `truncated`, the distiller treats truncated-with-nothing
  like a provider failure, and the ceiling went to 6000 tokens.
  What the run then proved, with the real embedder: a pending skill is **not**
  routed before approval, and after it, a question sharing none of the skill's
  words — "as paginas do site continuam mostrando conteudo velho depois que
  publiquei" against a skill written in English about Cloudflare 404s — brings
  it back first, `cos=0.83`, ahead of the built-in it was competing with. The
  router's semantic leg works across languages, which the fixtures in the gate
  could not have shown.
- 1.62 (2026-08-07): **The safety layer measured, and the distiller's taint
  check corrected (§8, §10, Backlog #8).** The injection corpus had only ever
  been tested in the flattering direction — write a payload, watch it match —
  so `tools/safety-scan.ts` (`npm run safety:scan`) now runs it over the
  repo's own prose and prints every flag with the text that caused it. The
  first measurement found three benign documentation lines reading `high`
  ("send an Authorization header, and a session token", `POST /v1/login {
  password }`, `POST /v1/auth/change-password`): the exfiltration patterns
  allowed sixty characters between the verb and the noun, which reference
  prose crosses constantly. The gap is now short and may not cross a newline,
  a table pipe, a brace or a slash, and the noun may not be the tail of a
  hyphenated word. 351 paragraphs, 11 flags, all of them the deliberate bare
  `system prompt` at `suspicious`.
  **The correction that mattered more** is in the distiller: it was reading
  the whole window — the user's messages included — through `sanitize`, which
  made the detector's own vocabulary radioactive. A bare "system prompt"
  flags nine paragraphs of this spec, so every conversation about how Pop Agent
  works would have been skipped, silently and permanently, since the
  watermark advances on a taint. It now reads **only tool output**, which is
  what §10's threat model was ever about: indirect injection is text that
  came from outside, and what the user typed is not that.
  New coverage the measurement showed was missing: **URL exfiltration** (a
  markdown image whose query string interpolates a secret — nothing is
  "sent", so every verb-based pattern was blind to it), four **Portuguese**
  phrasings ("a partir de agora você deve", "seu novo objetivo é"), and
  **base64** — encoded runs are decoded once and re-read with the same
  patterns, reported as `injection:<label>:encoded`. One level only: a
  decoder that follows its own output is a decompression bomb waiting for a
  hostile page.
- 1.61 (2026-08-07): **Auto-skill fase (c): the background distiller and the
  archiving collector are BUILT (§8, §13, §21).** The half nobody has to ask
  for. A maintenance job on the task scheduler's tick reads one idle
  conversation per tick — no idle conversation, no provider call, so the cost
  follows use — and distils what is procedural in it. A watermark per chat
  (`skill_distillation`) means a conversation that continues comes back with
  only its new messages; it advances on every outcome except a provider
  failure, so a bad minute at a provider costs a retry rather than a skipped
  conversation. `sanitize` gates the window before the model sees it: anything
  above `low` and the conversation is never distilled, which is the guard fase
  (b) got from the taint guard and a finished turn had from nothing. A
  candidate matching an existing skill (slug, or 0.90 cosine) lands in
  `skill_revisions` rather than the vault, so the approved version keeps
  serving the router until the user accepts the rewrite —
  the approval policy governs the update path too, without which the pending
  flag would guard the front door and leave the update path open. The
  collector is a cap (50 auto-skills, least used archived to
  `skills/_archive/`, never deleted), which keeps the annual procedure that
  any "idle for 90 days" rule would destroy. The original Settings gained
  `distillSkills` (on) and `distillIntervalMinutes` (10); the Skills screen gains the two
  queues, the archive, and one status line — no card, no push.
- 1.60 (2026-08-07): **Auto-skill fase (b), the router rebuilt on RRF, and
  the Service Model corrected to a per-provider pair (§2, §6, §7, §8, §15).**
  - **`sqlite-vec` removed from the spec.** It was never installed and is not
    a dependency; what exists everywhere is FTS5 + a `Float32Array` BLOB +
    a dot product in JS. The spec had been promising an extension the code
    never had, in four places, since 1.0.
  - **The Skill Router fuses with RRF**, reusing `fuseRankings` from the
    memory search rather than introducing a second mechanism. The
    hand-tuned blend it used to carry (a cosine turned into lexical points
    by a constant nobody could justify) is gone. Measured against the real
    24-skill vault: an absolute cosine bar cannot work in e5's compressed
    band, so the semantic gate is now a **z-score over each request's own
    spread** (z ≥ 2.1, 0.75 kept as a floor) — 7/10 on ten labelled
    requests with zero false positives, against 4/10 for the old blend. The
    same measurement settled "why not just match words?": lexical alone
    scores 2/10 here, because the user writes Portuguese and the skills are
    English, and no better lexical engine crosses that.
  - **Skill vectors persist** (`skill_embeddings`, migration 028), keyed by
    slug and stamped with the routing text they came from. Cold start 16.3s
    → warm 2.0s.
  - **`source: builtin | auto | user`** replaces the `builtin` boolean, with
    `builtin: true` still read from files written before today. Editing an
    auto skill promotes it to `user`; approving one does not. (The promotion
    had a bug found by its own test: `serialize` omitted `source: user` as
    "the default", and a promoted skill lives under `auto/`, where the path
    answers when the front matter does not — so the promotion was written
    and read straight back as `auto`.)
  - **"Vira skill" works, in any language** (fase b): a built-in
    `skill-creator` carrying its trigger sentences, and `skills_list` /
    `skill_write`. A tainted turn cannot write a skill — the only taint
    block keyed on a tool name, because a skill outlives its turn.
  - **Approval** (`autoApproveSkills`, default off), honoured by the router
    filtering `pending`, with `POST /v1/skills/:slug/approve` and a queue on
    the Skills screen. **`use_count`/`last_used_at`** (migration 029) record
    what earns its slot, for the collector that is not built yet.
  - **Service Model is a per-provider pair**, beside the credential, empty
    meaning "follow the chat model". `resolveServiceModel` /
    `resolveServiceChain`; titles and voice cleanup stopped reading a global
    setting, and the global `serviceModel` is gone from Settings. This
    supersedes 1.55, which had moved it to General — recorded there rather
    than silently overwritten.
  - Still open: the background distiller (fase c) and the archiving
    collector.

- 1.59 (2026-08-05): **Files as a plain folder is BUILT (§4, §6, §14 -- lands
  1.58).** Four commits, gate green throughout: the FilesService core
  (Garbage/ + `.garbage.json`, path-signed links, `file_provenance`,
  migration 026); the agent side (Files/ symlinked into the workspace,
  `save_artifact`/`read_artifact` retired for the built-in tools,
  `delete_file` that moves instead of removing, `files_search` as a live
  name walk, the provenance walk on run end); the path-based API and UI
  (`/v1/files` serves the real tree, uploads land in the open folder,
  rename and move are one path edit, composer @-mentions carry paths);
  and the removal (migration 027 drops the five catalog tables after
  bootstrap exports live rows to `files/<path>`, trashed rows to
  `Garbage/`, and seeds provenance -- then `artifacts/` is deleted).
  Verified against the real install: the two catalog rows landed with
  their names, the agent wrote `Files/resumo-redesign.txt` from a chat
  and provenance logged it, the tab lists the disk, a ⋯ → Download
  serves the exact bytes through the signed URL, and delete→trash→
  restore round-trips from the chat to the Trash screen and back.
  Caveat found live: the PWA's waiting service worker did not activate
  from the update toast (the button click left `waiting: true`); the
  session was fixed by unregistering the SW + clearing caches, and the
  update flow deserves a look of its own.

- 1.58 (2026-08-05): **Files becomes a plain folder (§4, §6, §14).** The
  catalog design — id-named blobs under `artifacts/<chatId>/`, an
  `artifacts` table, versions, a path index, trash rows — was carrying
  features this install does not want: Vinicius wants to `tree` his files
  over SSH, wants a re-save to overwrite, and wants the trash to be a
  folder he can open. So `POP_AGENT_DATA_DIR/files/` with real names is now the
  single source of truth; the tab renders the disk, uploads and the agent
  write straight into it, and `save_artifact`/`read_artifact` retire in
  favour of the built-in file tools. What survives, survives simpler:
  signed downloads sign the *path*; "which chat made this" is
  `file_provenance`, an append-only log that cannot desynchronize because
  history does not move; the trash is `files/Garbage/` plus a hidden
  `.garbage.json` (`{originalPath, deletedAt}`, the desktop `.trashinfo`
  idea) with a daily 30-day sweep; and the agent deletes through
  `delete_file(path)`, a tool whose real effect is the move to Garbage — a
  rule enforced by a tool beats a rule taught in a prompt (Vinicius,
  05/08). `files_search` drops to live name matching, names only for now.
  Versions, content search and the live file↔chat link are given up on
  purpose, not forgotten. Design recorded; implementation pending — this
  entry supersedes the artifact half of 1.47–1.53.

- 1.57 (2026-08-04): **Two CLIs, and a server that hands out its own
  client (§17).** `pop` is the chat client and `popman` the operator's
  tool; keeping them one command would drag `better-sqlite3`, `argon2`
  and code that knows where `secret.key` lives onto every laptop that
  wants to chat from a terminal. `popman` ships with the server and is
  the only thing touching systemd, SQLite and the backups directory;
  `reset-password` lives there and NOWHERE else, because it proves
  nothing and owning the machine is the proof -- an HTTP route with the
  same power would be a password reset for anyone who found the URL.
  `access-list` is named in §18 and is **not built**; the command says so
  rather than pretending.
  Distribution: `npm i -g <server>/cli-X.Y.Z.tgz`, chosen because for
  self-hosted software the thing you run should hand you the thing you
  talk to it with, and the install line then carries its own address. It
  is NOT what prevents client/server drift -- that was the earlier
  reasoning and it only holds on the day of the install; the server moves
  on and the laptop keeps what it was handed. **The attach compares the
  versions**: silent when compatible, one line when merely behind, and
  refused with the install command below `MIN_CLIENT_VERSION`, which is
  set by hand and moves only when the wire changes. Packing bundles every
  `@pop-agent/*` into `dist/` and leaves the two public dependencies external,
  which is what makes the tarball installable at all (`npm pack` alone
  404s on `@pop-agent/shared`).
  Also: **hands belong to the message, not the chat** (docs/cli.md). A
  chat used to have an owner, so a message from the phone ran commands on
  whichever laptop had opened it -- possibly one that is shut. The
  terminal now names itself on each message (`x-pop-agent-local-connection`), which
  deleted the ownership map, the claim frame and the spectator rule.

- 1.56 (2026-08-04): **Every message remembers where it came from (§13).**
  Migration 024 adds `client`, `client_platform` and `client_ip` to
  `messages`. **Per message, not per connection**, because a conversation
  moves between devices and the value is reading that back later; a
  connection only ever answers "where are we right now", which is the one
  thing the user could have said out loud (Vinicius, 04/08).
  Vocabulary: `web | pwa | desktop | cli | api | task`. **`mobile` is
  deliberately absent** -- a form factor is not a client, and "PWA on an
  iPhone" would otherwise be two answers at once; the phone half is the
  platform. Named `client`, NOT `source`: that word is already an
  artifact's `agent`/`upload` and a title's `auto`/`manual`.
  Carried in `x-pop-agent-client` / `x-pop-agent-client-platform`, set once in each
  client's api layer so every call has it, and validated at the edge --
  an unknown value is recorded as nothing rather than passed through into
  the model's context. NULL is the honest value for the 427 rows that
  predate this and for every assistant and system message, which no client
  sent. A header is **forgeable by anyone holding the token**, which on a
  single-user install means the owner: it is context, never a security
  decision.
  **The agent is told only when the channel CHANGES** (`channel-note.ts`),
  plus once at the start of a conversation. Repeating "this came from the
  CLI" on all fifty turns is fifty copies of a fact that mattered once,
  paid for on every request. **The IP never reaches the model**: it answers
  "who connected", which is an audit question, and nothing she says would
  change for it -- what enters the context enters the memory and the
  backups forever. It is read from `x-forwarded-for` behind a proxy and
  from the socket otherwise; reading only the header recorded nothing for
  every direct connection.
- 1.55 (2026-08-04): **Providers are added, not configured (§14, §15).** The
  Model screen used to show every provider Pop Agent knows about, configured or
  not, each an open form -- six cards to read before finding the one you had
  set up, plus a separate drag-to-reorder priority list. Now the screen says
  what you HAVE: an **Add provider** button, then one card per configured
  provider with Edit and Delete. Adding walks a wizard -- pick from the six
  (OpenRouter / OpenAI / OpenAI subscription / Anthropic / GitHub Copilot /
  Custom), give it what that one needs, choose a **Priority**. A builtin
  already set up is offered greyed as "already added"; custom instances can
  be added as often as you like.
  **Priority is a 1..N dropdown over the configured providers**, replacing
  the drag list (`priority-list.tsx` deleted): "who answers first" is the
  question a person asks, and a drag gesture answers it only once learned.
  N counts configured providers only -- "priority 3" has to mean the third
  thing that answers, not the third row of a list including providers never
  set up. It writes the same `provider.order` the fallback chain already
  reads (§15 fase 2), so the engine did not change at all.
  Every provider can be **tested**, subscriptions included -- the server
  checks those with pi's own auth check rather than a paid probe, so hiding
  the button there made no sense. **Model** is a searchable picker over the
  provider's own catalogue, falling back to a typed field where the endpoint
  publishes none (a custom Ollama, typically) -- an empty picker is a dead
  end. `MAX_CUSTOM_PROVIDERS = 256` caps how many custom instances exist **at
  once**, never how many ever existed: deleting frees its place (Vinicius,
  04/08). The service model (titles, summaries) moved to General; it is a
  background behaviour, not a provider. **Superseded by 1.60**, which moves
  it back beside the credential as a per-provider pair — the reasoning above
  was right about it being a background behaviour and wrong about what that
  implies, because a model id is meaningless outside one provider's
  catalogue. Recorded rather than silently overwritten, at the owner's
  request.
- 1.54 (2026-08-04): **Audio is its own Settings section (§14).** "Voice
  model (whisper)" and "Improve transcripts with AI" were the last two
  cards under Model, where Model means the one that answers you -- so a
  transcription model and a cleanup pass sat under a heading about
  something else, and anyone looking for the microphone had no reason to
  open it. Both cards move to a new **Audio** section, unchanged; they were
  already self-contained, so the move is a relocation, not a rewrite.
- 1.53 (2026-08-03): **The Trash is a place inside Files, not a screen you
  were sent to (§14).** It carries the same breadcrumb -- `Files > Trash`,
  with `Files` as the way back, which is why the Back button it used to
  have is gone (Vinicius, 03/08). The breadcrumb moved out of files-page
  into `ui/Breadcrumb` (crumbs + limit + onOpen, owning its own collapse
  menu) and `MenuItem` moved to `ui/controls`, its real home: two screens
  had to look identical, and this codebase already has the lesson written
  down about a look that gets hand-copied into a second place (FIELD_BASE).
  The Trash entry in the Files toolbar is the drawn bin, no word -- among
  four worded buttons "Trash" read like a fifth action rather than a place.
- 1.52 (2026-08-03): **Files has a trash (§14, §6, §21).** Deleting a file
  or a folder is reversible for **30 days** -- the number Drive, Dropbox and
  iOS use, so nobody has to learn a new one. Migration 021: `deleted_at` on
  `artifacts` and `folders`. **Soft delete, never a move**: the bytes stay
  where they are under the same id, because moving them into a `trash/`
  directory would double the paths one file can live at and a crash halfway
  would leave an orphan nobody can find.
  Four decisions worth keeping. (1) **The index goes immediately.** A
  trashed file's chunks and embeddings are dropped the moment it is deleted
  (`onDeindexed`, wired in main.ts) -- thirty days of the agent still finding
  and citing a file the user threw away is the worst kind of bug, silent and
  embarrassing. A restore reindexes through `onStored`. (2) **The bin never
  reaches into the live tree**: `folders_sibling_name` became a partial
  unique index (`WHERE deleted_at IS NULL`), so a deleted folder cannot stop
  you creating another with its name. Restoring into a name that was taken
  meanwhile answers **409 `name_taken`**, not a crash and not a silent
  rename. (3) **A subtree is one thing.** Deleting a folder stamps its whole
  subtree with ONE instant, so it expires together, lists as a single entry,
  and comes back together. Restoring anything also restores its trashed
  ancestors -- a folder's parent is fixed at creation (§6), so dropping an
  orphan at the root would be moving something the user only asked to
  undelete. (4) **A purge takes the archived versions too**, via a new
  `ArtifactStore.removeVersion`; freeing only the current bytes would leave
  copies on disk under a name nothing points at. `TrashSweeper` (a
  MaintenanceJob on the daily tick) empties what is past its window;
  thirty days is a floor, not a deadline. `GET /v1/trash`,
  `POST /v1/trash/{files,folders}/:id/restore`,
  `DELETE /v1/trash/{files,folders}/:id`, `DELETE /v1/trash`, and a Trash
  screen reached from the Files toolbar that says how many days each thing
  has left.
- 1.51 (2026-08-03): **Measure the disk before limiting it (§14, §16).** A
  trash and a quota for Files were asked for; this lands the measurement
  first, on the principle that a limit chosen without looking caps the
  wrong thing. New `GET /v1/storage` + Settings -> Storage: one line per
  kind of weight, heaviest first, with the filesystem's own free space
  beside it. `application/storage/storage-service` composes two new ports
  -- `StorageRepo` (what only SQL knows: live files vs archived versions,
  and how much of the db is derived index) and `DiskUsage` (directories,
  files, statfs; every method answers instead of throwing, because a
  directory that does not exist yet is a normal install state worth a
  zero). Nothing is counted twice: the artifacts directory is measured
  once and split by the database's own size column, and the index is
  shown as a slice of the database file rather than added to it. Backups
  are counted although they live OUTSIDE the data directory -- they are
  ten full copies of it (§16), which is the point.
  **The first install it was pointed at settled the argument**: 1.7 GB of
  downloaded whisper weights against 224 KB of files, and 1.5 GB of that
  a `medium` model that is not even the configured default. Downloaded
  weights therefore get their own line rather than sitting inside
  "everything else" -- the biggest number on a disk must be the most
  legible one, not the least. Open questions the numbers now inform, not
  yet decided: the trash itself, a Files quota, pruning old versions,
  removing unused voice models, and whether backups should keep ten full
  copies of the artifacts at all.
- 1.50 (2026-08-03): **Pull down to refresh, on the phone (§14, §15).** An
  installed PWA has to build this itself: Safari's own pull-to-refresh
  exists in a browser tab and NOT in standalone display mode, which is how
  Pop Agent runs on a phone, so the gesture every phone user knows was simply
  missing. `lib/pull-to-refresh` + `ui/PullToRefresh` wrap a scroll area;
  the chat list and Files use it. Chrome's model, not iOS's -- the list
  stays put and a spinner slides over it, because translating the scroller
  would fight the row menus that position against it. The gesture is
  decided once and never taken back, the same rule the chat rows' swipe
  follows: it must start at `scrollTop` 0, go downward, and be more down
  than sideways, or it belongs to the scroll or to the row's own
  delete/archive. Once it is ours, `preventDefault` on a non-passive
  `touchmove` is also what stops iOS rubber-banding the whole app.
  **A pull refreshes the data AND asks the server for a new build**, which
  is the other thing a phone cannot find out on its own (§15: an installed
  PWA only re-checks its worker on navigation). The two run under
  `allSettled` -- a server that is down must not stop the cached list from
  redrawing. New `services/update-signal` keeps that reachable without
  spreading the poison: `services/pwa-update` imports
  `virtual:pwa-register`, which resolves only inside a vite build, so
  anything importing it becomes unimportable from a test (the reason
  oauth-section was carved out of settings-page). `ui/update-prompt` stays
  the single door and registers the real checker on mount.
- 1.49 (2026-08-03): **Files acts on the row you point at (§14, §6).** The ⋯
  beside the breadcrumb is gone: it held one entry, "Select files", and a
  menu next to the title was a second place to look for something the row's
  own ⋯ could offer. Selection now starts from the item itself -- "Select
  folder" first in a folder's menu, "Select file" second in a file's -- and
  **folders are selectable too**, with their own checkbox and their own set,
  so a batch can mix both. Move to… hides while a folder is ticked, because
  a folder's parent is fixed at creation (§6) and moving one is not a thing
  that exists. **"Open file"** is the new first entry of a file's menu: the
  download route takes `?inline=1` and, for types
  `domain/artifacts/inline-view` allows, serves `Content-Disposition:
  inline` so the browser displays it -- PDF, image, plain text, audio,
  video, with text-ish types (markdown, csv, json) relabelled `text/plain`
  so they are read rather than saved. An **allowlist, never a denylist**:
  `text/html` and `image/svg+xml` are excluded on purpose, because uploaded
  markup rendered inline on Pop Agent's own origin can read the session token;
  anything unrecognised downloads, as before. `nosniff` and a `sandbox` CSP
  ride along. A web page cannot hand a file to the operating system's
  default application -- that door is closed to every website -- so "open in
  the system viewer" means the browser's, and the share sheet from there.
  The flag sits outside the HMAC on purpose: it authorises nothing the
  signature did not already, and signing it would void every link already
  handed out.
- 1.48 (2026-08-03): **A server that is down says so (§14).** A 12px dot at
  the bottom of the sidebar was the only sign that the app could not reach
  its server, and in a PWA that is nearly invisible: every screen still
  paints from the service worker's cache, so the app looks alive and only
  the answers stop coming. New `ui/connection-banner` -- a full-width bar
  at the top of every screen, mounted above the router so the failed boot's
  fallback to login carries it too. Three states rather than one, because
  the user's next move differs: "You're offline." (their network),
  "Server is offline. Your internet is working -- the problem is on the
  server. Nothing you typed was lost. Trying to reconnect..." (naming the
  culprit is the point: otherwise the first suspect is always the wi-fi),
  and "Back online." for 3s, so an outage does not end in silence. A bar,
  never a modal -- the conversations already loaded stay readable, and
  taking them away would remove the only thing that still works. The health
  dot keeps the *degraded* diagnoses, which are the ones a user could act
  on. `services/health` becomes the connection monitor: a 60s keepalive
  while healthy, a 5s-doubling-to-30s retry while unreachable (so "trying
  to reconnect" is true, plus a "Try now" button), `navigator.onLine ===
  false` short-circuiting the request and separating the two failures, and
  a hard stop while the page is hidden -- iOS freezes a backgrounded PWA
  within seconds, so a surviving timer would resume holding a verdict from
  whenever the system suspended it. It wakes on `pageshow`/visible like
  `services/events` already did: the wake-up probe matters more than the
  interval. `services/api` now doubles every request as a probe, so a send
  that never landed raises the banner immediately instead of a minute later.
- 1.47 (2026-08-02): **Folders nest, and Files search has an index (§14, §6,
  §21).** Folders were flat with a global `UNIQUE(name)`; they gain a
  `parent_id` (migration 020) so a folder holds folders as well as files,
  and "unique among siblings" (a `UNIQUE(COALESCE(parent_id,''), name)`
  index) replaces the global one, so `Projetos/specs` and `Clientes/specs`
  coexist. The parent is fixed at creation and never moves, so no cycle can
  form; deleting a folder takes its whole subtree -- descendant folders and
  their files, records and bytes both (files first, folders deepest-first,
  so no FK dangles). Rebuilding `folders` while `artifacts.folder_id`
  references it needed care: RENAME rewrites the child FK to follow the
  renamed table, so the migration builds the new table under a temp name,
  drops `folders`, then renames the temp *into* `folders` (the child FK text
  stays `REFERENCES folders`, now resolving to the rebuilt table),
  `defer_foreign_keys` covering the window -- verified against the real db
  (`foreign_key_check` clean). The Files list is now a tree in both the
  sidebar and the content pane: a folder with children carries a `+`/`-`
  toggle that opens it in place, while its name still navigates in. Search
  no longer filters the loaded list in the browser (which hid folders and
  missed anything below the open folder); a materialised `path_index` table
  holds every folder and file with its full path, and `GET /v1/files/search`
  matches a name or any path segment across the whole tree, returning
  folders first then files, each with its path. The index is a cache:
  `PathIndexService.reindex` rebuilds it whole after every Files mutation
  (an `onFilesChanged` hook on the artifact service), once at boot, and once
  a day at 01:00 local as a safety net (a `FilesReindexJob` maintenance job
  on the scheduler's tick). On a phone the Files search box drops to its own
  full-width line so the toolbar buttons no longer crush it.

- 1.46 (2026-08-02): **The field controls are primitives now (§14).** Two
  layout bugs had just been fixed in one shared component each and
  disappeared from five screens at once; an audit then found the places
  where that leverage did not exist — eight hand-rolled `<select>`, five
  `<textarea>`, five raw checkboxes, each carrying its own copy of the
  field class string, already drifted. `Select`, `TextArea` and a shared
  `Field` shell join `TextField`/`CheckField` in `ui/controls.tsx`, with
  the skin in one constant and size as a prop. `<Button>` was measured
  too and left alone: none of the 41 raw `<button>` imitate it — they are
  icon buttons and list rows. One real a11y hole closed on the way: the
  file-row checkbox had no accessible name, and the interval unit select
  answered to "Schedule", the same name as the group around it.
- 1.45 (2026-08-01): **A task can run without shouting (§21), and a note
  can be added to (§11).** Both came out of the same job: a task on a
  ten-minute interval writing to one markdown file. It buzzed the phone
  every ten minutes and opened a chat in the sidebar every ten minutes,
  so the schedule that worked was the one you switch off; and the only
  way to write was `notes_write`, which replaces the file, so "add to
  this note" meant read-glue-write — silent truncation above the 64 KiB
  read cap and a full copy of the note in context for a two-line
  addition. Tasks gain `notifyOnFinish` and `archiveChat` (migration
  018); `startRun` gains `{ notify }`, which silences the push alone and
  still counts the run for health. The vault gains `append`, exposed as
  `notes_append`, which writes past the end of the file without reading
  it and guarantees the added text starts its own line.
- 1.44 (2026-08-01): **The list is the only priority, and a dead
  endpoint no longer freezes the chat (§15).** Two faults met in one
  bug report: the failover chain still put the stored global default
  ahead of the user's list — a hidden #0 — and one install's default
  was an Ollama endpoint on a machine that was switched off. Every new
  chat went there and hung forever: no answer, no error, no journal
  line, because the chain can only act on an error that returns and a
  hung socket never returns. The chain now follows the list alone, and
  an attempt that says nothing for 60 s is abandoned for the next
  provider.
- 1.43 (2026-08-01): **The provider priority is the user's to edit
  (§15).** The failover order was hardcoded — definition order, after a
  global default that lived in its own Settings control — so there was
  no way to say "try this one first" or "never this one", and the
  default could name a provider the chain did not start with. Settings
  now shows one numbered list: #1 is the default, the order below it is
  the failover order, and each row has an on/off switch. Ported from
  aw, including its lesson that activation and #1 must be one lever.
- 1.42 (2026-08-01): **The subscription sign-in stops reading as broken
  (§15).** pi offers two login methods and advertises the browser
  redirect as the default; on a self-hosted install that is the one
  method that cannot finish by itself, and it dead-ends on a blank
  `localhost` page whose address the user is expected to copy out of
  the bar. The card now names the choice in Pop Agent's own words with the
  code method first, and the redirect path reads as three steps that
  warn about the failed page before asking for its address. Both paths
  still work; an API key remains the third way in.
- 1.41 (2026-08-01): **A sign-in survives the round trip (§15).** The
  OAuth card only rendered flows started in that same mount, so coming
  back from the provider -- a reload, a new tab, the PWA resumed --
  showed "Sign in" again while the server sat waiting for the code, with
  no way to hand it over. The card now adopts a running flow on mount,
  and spells out that the blank `localhost` callback page is expected
  and is itself what must be pasted back. The section moved into
  `oauth-section.tsx` so it can be tested at all: the settings page
  pulls in the PWA registration virtual module, which no test
  environment can resolve.
- 1.40 (2026-08-01): **iOS push actually arrives (§14).** The whole chain
  existed — service worker with `push`/`notificationclick`, the Settings
  opt-in, `/v1/push/*`, the send on run finish — and delivered nothing on
  iPhone, because the VAPID `sub` claim was `mailto:pop-agent@localhost` and
  Apple validates it: measured against web.push.apple.com, that subject
  answers 403 `BadJwtToken` while a real public URL answers 201. Pop Agent now
  signs with its own project URL by default, `POP_AGENT_PUSH_SUBJECT` takes an
  operator `mailto:`/`https:` URI, and an override that would be rejected
  upstream is dropped for the default rather than honoured — a typo must
  not silently switch every notification off. §14 gains the end-to-end
  description so the next reader does not have to rediscover the trap.
- 1.39 (2026-08-01): **A deleted chat takes its work with it (§6), and a
  daily orphan sweep (§21).** `DELETE /v1/chats/:id` now stops the chat's
  run *before* the first row goes: new `RunService.discardChat` aborts the
  started attempt (pi kills the process group) and drops anything of that
  chat still queued. The order is asserted in a test — abort, delete,
  purge — because a run streaming into rows about to disappear keeps a
  process group alive, keeps spending credit, and ends on a foreign-key
  failure; the unwinding run now finds its chat gone and stores nothing.
  The workspace attachment purge is wired into the test fixture too, so
  "the folder is gone" is a claim with a test behind it. New internal
  maintenance job `WorkspaceSweeper`, daily on the scheduler's tick:
  removes `attachments/<chatId>/` for chats that no longer exist plus
  root-level scratch older than 30 days (`.png`, `.yaml`, `.mjs` only),
  never a live chat's attachments, never a directory, never a symlink,
  never anything outside POP_AGENT_WORKSPACE, never the database. One journal
  line per sweep with the counts. Session history is forever: sweeps touch
  only derived workspace files.
- 1.38 (2026-08-01): **Background tasks (§21).** New third sidebar tab —
  a prompt with a schedule (`once` or every N minutes), table `tasks`
  (migration 017), repo port + SQLite adapter. The scheduler lives in
  `application/` with the clock and the timer both injected
  (`ports/timer.ts`), ticks every 30s from main.ts, and works one single
  FIFO queue — never two task runs at once, because every run is a full
  agent turn and each opens its own chat. A run opens a fresh
  conversation, renames it to the task title through the manual-rename
  path (so `auto_title` goes off and no titler ever overwrites it), and
  goes through the normal RunService for failover, compaction and error
  persistence. Finishing records last_run_at / last_status / last_chat_id,
  parks an interval task one interval from when it *finished*, and
  switches a `once` task off; a failing run is a recorded status, never an
  exception that stalls the queue. New `RunService.whenRunEnds(runId)`
  answers "how did this run end?" in code, which an SSE broadcast cannot.
  Routes `GET|POST /v1/tasks`, `GET|PATCH|DELETE /v1/tasks/:id`,
  `run-now` (202, queued) and `toggle`, all session-guarded, strict Zod,
  new code `task_not_found`. Editing a schedule or switching a task back
  on re-parks it from now. UI: Chats | Files | Tasks, the list in the
  sidebar with switch / Run now / Delete, create and edit as a full-screen
  route. Also: the first-message title fallback now respects `auto_title`,
  so a hand-picked name is never overwritten even when it looks generic.
  New `ports/maintenance-job.ts`: internal housekeeping rides the same
  tick without being an agent-visible task.
- 1.37 (2026-08-01): **Type-enforced route protection (§9).** Routes
  mount only through `mountApi()`: branded `SessionGuardedRoutes` vs
  `publicSurface(reason, …)` — an unauthenticated URL no longer
  compiles by accident. `PUBLIC_V1_PATHS` becomes the single source of
  truth for guard exemptions (auth middleware derives from it), each
  with a written reason. A probe test walks every registered /v1 route
  sessionless and demands 401 unless declared, and asserts the HMAC
  download surface answers 4xx without a valid signature. healthz and
  /v1/health moved into their own mini-app to be blessed explicitly.
  Listed future: SecretString branding on the same pattern.
- 1.36 (2026-08-01): **Unlimited custom providers (§15).** The single
  fixed `custom` slot becomes a registry of user-created
  OpenAI-compatible instances (`provider.custom.registry`), ids
  `custom-` + 5 hex bytes with collision re-roll, one sealed key per
  instance under `provider.<id>.apiKey`, deleted with it. Definitions,
  statuses, resolve, the failover chain and the catalog all consume
  builtins + synthesized instance definitions (customs after builtins,
  registry order); pi registration is lazy per instance, no restart to
  add or edit. New routes `POST /v1/providers/custom`,
  `PATCH|DELETE /v1/providers/custom/:id`; the legacy
  `PUT /v1/providers/custom/config` is removed with its UI. Settings
  gains "Add custom provider" cards (name, endpoint with live
  "requests go to" normalization, model, write-only key, Test,
  Delete; add-then-cancel discards). Boot migration turns the legacy
  slot into one instance, moves the key, clears the legacy entries and
  aliases `custom` → the new id for old chat overrides.
- 1.35 (2026-08-01): **Automatic provider fallback (§15, fase 2).**
  The run loop iterates a failover chain (override → default → every
  usable provider, deduped, each with its default model) instead of
  calling the bridge once. Failures are classified TYPED
  (`shouldFailOver`): fail-forward on 401/402/403/404/408/429/5xx,
  transport errors and `provider_not_configured`; never on 400, Stop
  or a tainted turn; unknown stays put — the bridge now parses the
  HTTP status out of provider refusals and tags network failures.
  Mid-stream failures never fail over (tokens already rendered) but
  penalize. New in-memory advisory `ProviderCooldown` (5 min): the
  chain skips penalized providers unless all are; key save / sign-in
  forgives; restart resets. Failover is loud: persisted system message
  in the chat + `pop fallback:` journal line; every billed attempt
  books its own `llm_runs` row (`<runId>-f<n>` for retries). Context
  overflow keeps its §7 compact-and-retry path, same provider.
- 1.34 (2026-08-01): **Subscription providers via OAuth (§15, fase
  1.5).** `openai-codex` (ChatGPT subscription) and `github-copilot`
  (Copilot subscription) join the declarative list with
  `authType: "oauth"`. pi's `ModelRuntime.login` runs the whole flow;
  Pop Agent adds a single-active `OAuthFlowService` (10-minute timeout, new
  flow cancels the old), five `/v1/providers/:id/oauth/*` routes
  (start/state/input/cancel/logout), and the Settings card swaps the
  key input for Sign in / Disconnect with the flow's transcript inline
  (auth_url link, device code, one pending question). Credentials live
  only in pi's store (`pi-auth.json`); no token material on the wire;
  status reports `source: "oauth"`, resolve counts a signed-in
  subscription as usable, test wraps pi `checkAuth`, and an oauth
  session opens keyless.
- 1.33 (2026-08-01): **Health where the user can see it (§13, §14).** New
  public `GET /v1/health` reporting `{server, provider, db}` from cheap
  cached signals (key configured + last run outcome, `SELECT 1` on the
  database), and the sidebar's app bar moves to the bottom as a floating
  strip the chat list scrolls behind, gaining a gently pulsing red health
  button that only appears when something is wrong. Backend first; the
  frontend strip lands in the same change.
- 1.31 (2026-07-31): **Agent-written skills are English (§8).** The agent
  authors its own skills in English, like the rest of the repo; end-user
  skills stay free-language. Decided live: the agent's first two
  self-authored skills (`self-change`, `field-lessons`) date from today —
  it created the self-change flow unprompted after being taught
  edit→gate→commit, and the router picked both up within minutes.

- 1.30 (2026-07-31): **A real browser, and a crawler that hunts dead
  buttons.** Playwright + headless Chromium land as a dev dependency. Two
  uses: (1) the agent can browse the internet — a routed **web-browsing**
  skill teaches it to drive Chromium from bash for javascript pages,
  clicks and screenshots, with the rules spelled out (untrusted content,
  web_fetch's address policy, close the browser, prefer web_fetch for
  static pages); know-thyself mentions the capability. (2)
  `npm run ui:crawl` (tools/ui-crawl.ts) boots a throwaway pop (temp
  data dir, fake agent), logs in through the real form at a desktop and a
  phone viewport, clicks every visible button on every screen, and
  reports NO-OP buttons and console errors with screenshots — the class
  of bug Download just was, hunted by machine. Not part of the gate.

- 1.29 (2026-07-31): **Files awareness built (§7.4).** `filesCatalogBlock`
  (names + folders, 30 newest, untrusted-delimited, with the
  search-before-shrugging line) joins the bridge's instructions next to the
  pinned skills, so a new upload reaches the next run via the session
  reopen; know-thyself teaches the same instinct. Seeding gained an
  amnesty: a pre-seed-era default file still identical to the shipped
  content gets stamped with the seed hash and follows upgrades from then
  on (v0.2 installs heal by themselves; a truly edited file stays the
  user's). Fixes shipped same day: on a phone the Files screen keeps the
  app header — a shared ShellHeader rendered above the breadcrumb
  (`md:hidden`) instead of vanishing with the sidebar; Download works
  again everywhere — the signed link arrives after an await, so
  `window.open` was popup-blocked, replaced by an anchor click
  (`web/src/lib/download.ts`) over the attachment disposition.

- 1.28 (2026-07-31): **Files awareness (§7) — design recorded,
  implementation pending.** A Files catalog (names + folders, recent N,
  untrusted-delimited) joins the session instructions, and know-thyself
  gains the search-before-shrugging instinct: unknown term →
  `files_search` + `memory_search` before the web. No per-turn RAG chunk
  injection — the agent fetches with its own tools. Motivated by the
  OffSchool dialogue, where the answer sat in a filename the agent could
  not see. Also validated live today: the self-architecture skill routed
  at 6.54 for the auto-programming question and Pop Agent answered TypeScript
  with the platform's own reasons.

- 1.27 (2026-07-31): **Self-knowledge hardening built (§8).** Skills carry a
  `pinned` flag (frontmatter, DTO, save schema); the router skips pinned
  skills and their bodies lead the session system prompt through the
  bridge's instructions string, which already reopens a session when it
  changes — so a pin edit reaches the next run. know-thyself ships pinned,
  and is pinned by code even where a v0.2 file predates the flag. The
  router service reports every selection and main logs
  `pop skills: <slug>=<score> …` — slugs and scores only, never message
  content. New routed **self-architecture** skill: the decision rule
  ("your extensions are TypeScript on your own runtime"), how to read
  your own source, and the generated repo/UI map. The map lives in
  `self-map.generated.ts`, emitted by `tools/generate-self-map.ts`
  (`npm run selfmap`); `selfmap:check` opens the gate, so drift fails the
  build. Seeded defaults now carry a `seed` content hash: a default the
  user never edited upgrades with the ship, an edited one stays theirs.
  The Portuguese messages from the motivating dialogue are router test
  cases (default-skills.test.ts).

- 1.26 (2026-07-31): **UI map joins the self-map (§8).** The agent has no
  AX tree of its own PWA — it runs server-side; the interface renders in
  the user's browser, out of reach. Navigation knowledge ships as data
  instead: the self-map generator derives a UI map (routes from
  `web/src/App.tsx`, labels and Settings sections from
  `web/src/i18n/en.ts`) so Pop Agent can guide the user through its own
  screens. Design recorded; implementation pending with 1.25.

- 1.25 (2026-07-31): **Self-knowledge hardening (§8) — design recorded,
  implementation pending.** Motivated by a real PT dialogue where the
  router never surfaced know-thyself and Pop Agent recommended Python for its
  own extensions. Four rules land in §8: skills can be **pinned** into the
  session system prompt (know-thyself ships pinned; pinned set stays
  tiny); the router **logs selections and scores** per turn, and
  thresholds are tuned from those logs (e5 similarity is band-compressed
  — do not eyeball the floor); `whenToUse` carries translation-stable
  PT/EN trigger tokens, with misrouted real dialogues as test cases; and a
  routed **self-architecture** skill carries the deep map — layers,
  dependency rule, where the source lives, "Pop Agent's extensions are
  TypeScript on Pop Agent's runtime" — with its repo-map section generated by a
  script, never hand-written.

- 1.24 (2026-07-31): **Round 6 — voice raw-first, Files, semantic file
  index.** Voice (§14): the transcript is used raw the moment whisper
  finishes (measured 5.9s end-to-end for 11s of audio); the LLM cleanup
  is an opt-in in Settings with its own model picker (empty = service
  model). Files (§14): the Artefacts tab is renamed **Files**, the
  Chats | Files picker sits above New Chat, and Files is a flat folder
  tree -- upload (root or open folder), download, rename, delete per
  file; New/Rename/Delete Folder, folder delete warns it removes the
  files inside. Chat uploads land at the root. A file may exist without
  a chat: migration 012 rebuilds artifacts with chat_id nullable and
  adds folders; chatless bytes live under artifacts/_files/. Semantic
  index (§7/§14): migration 013 adds artifact_chunks (extracted text,
  chunked, one BLOB embedding per chunk, FK cascade); a FileIndexer
  trails every stored file off the request path with a boot backfill,
  and the agent gains **files_search** -- validated live: the real
  agent found a fact planted in an uploaded file. New surface: POST
  /v1/artifacts (chatless upload), PATCH /v1/artifacts/:id,
  GET/POST/PATCH/DELETE /v1/folders (§13).

- 1.23 (2026-07-31): voice default model is **base** (§14) — measured on
  the 4-core test server with an 11s sample: base 5.5s / small 18.8s /
  medium 63.4s, near-identical transcripts; the maintainer revised his
  earlier medium-default decision. Settings → Voice still offers the
  full manifest.

- 1.22 (2026-07-31): **Rounds 4–5 built** (list redesign, per-device
  prefs, resilience, the Updates screen). Decisions recorded: the home
  list gains **Chats | Artefacts segments** with search reaching archived
  chats (badged) and a deliberate menu -> View archived — the pinned line
  and the collapsible footer are gone (§14); **swipe on a chat row**:
  right = delete (confirmed), left = archive (not) — the maintainer's
  mapping, deliberately the inverse of iOS Mail (§14); the per-chat knobs
  (thinking visibility toggle + model picker) live **in the chat header**,
  always visible while reading -- reversed the same day from a strip under
  the composer (§14);
  **font size** and **thinking visibility** are device-scoped localStorage
  prefs like the theme (§14); **SIGTERM/SIGINT flush**: a server restart
  parks every in-flight run's partial answer as an interrupted-marked
  message instead of eating it (§6, §14); **Settings -> Updates** ships
  its first cut (§15): three cards — the PWA check (moved from
  Appearance), the Pop Agent server card reading the latest origin tag with
  the update command shown (the **notify-only** channel: one push per new
  version, deep-linking to ?section=updates; applying stays a shell act),
  and an Environment card (pi/node/ffmpeg/poppler/tesseract/whisper
  versions, visibility only). GET /v1/artifacts (all chats) joins §13.
  Fixes shipped same day: DELETE responses parse (204), unarchive
  refreshes both lists, composer scrollbar only at its cap, the update
  Reload button reloads unconditionally, voice model default small on
  this hardware (medium measured 5.8x realtime on 4 cores).

- 1.12 (2026-07-31): **v0.2 built, tagged v0.2.0.** Skills + the Skill
  Router (§8): markdown skills under POP_AGENT_DATA_DIR/skills, a pure lexical
  router that prepends the relevant few per turn, 15 defaults led by
  know-thyself, a full-screen CRUD in Settings. Backup/restore as tar.gz
  with the key excluded (§16). Web Push when a run finishes, VAPID keys in
  the secrets table (§14). Passkeys via WebAuthn for Face ID unlock (§9).
  Local voice already shipped in 1.10. Cost dashboard over llm_runs (§14).
  Two decisions recorded here: **attachments extraction** — Pop Agent does not
  bundle a PDF/DOCX/OCR pipeline like aw; attachments are written into the
  agent's workspace and the agent extracts what it needs with its own
  tools (pdftotext, unzip, its reader), which fits Pop Agent's "agent with real
  fs" design where aw's server-side extraction fit its tool-less desktop
  app. **Update channel** (§15): Pop Agent does not self-update from the running
  process; `GET /v1/update/status` reports the installed versions and the
  latest pi on npm, and Settings shows the one-line shell update command,
  which runs the same `npm run gate` before restarting. Automatic
  pi-update gate with rollback/probation stays documented for a later
  version — the manual path is gated and safe.

- 1.11 (2026-07-31): **Phase 4 complete, tagged v0.1.0.** The agent got
  its own notes vault (§11) behind aw's path jail, exposed as
  notes_list/read/search/write pi tools; web_fetch with SSRF protection
  and the safety envelope (§12); lexical memory over an FTS5 index of
  every message with memory_search/open/recent and a recent-chats
  catalog in the system prompt (§7); and a living user-memory document
  with a one-level backup, its own tools and GET/PUT /v1/memory (§7).
  Custom tools are built with typebox (added as a direct dependency).
  Conversation compaction is pi's own: it auto-compacts on context
  pressure (SessionCompactEvent), so Pop Agent builds nothing and inherits it.

- 1.10 (2026-07-31): Phase 4 begins and the mode changes. The external
  content safety layer landed (§10): pure sanitize (invisible-strip by
  codepoint, NFC, base64 flag, ~40 EN+PT injection patterns over
  accent-folded text) and the per-turn taint riding pi's tool_call /
  tool_result hooks, with a `confirm` SSE card + `POST /chats/:id/confirm`
  gating destructive bash in a tainted turn. Deleting a chat now deletes
  its JSONL, sidecar and attachments too, not just the rows (§6). Voice
  moved from a cloud model to local whisper.cpp (ffmpeg + whisper-cli on
  the server, no tokens). And the process itself: continuous execution,
  no manual acceptance between phases (§20).

- 1.9 (2026-07-31): Phase 3 finished — the pi bridge (steps 0–2, spec 1.8
  session) grew the provider, the titles and the accounting (steps 1, 3,
  4). OpenRouter configuration: the key lives in the encrypted secrets
  table, beats `OPENROUTER_API_KEY`, is write-only on the wire, and can be
  tested with one five-token completion (§9, §15); `GET /v1/models`
  prefers the live catalog (key present, cached 24h) and falls back to
  pi's offline built-in one, so CI never touches the network. Settings
  grew `defaultModel`, `serviceModel` and `customInstructions`; the
  instructions reach pi through a `DefaultResourceLoader` that replaces
  the coding persona with Pop Agent's neutral prompt and disables pi's CLI
  resource discovery (§5). Auto-titles: at the user's 3rd turn and every
  10th after, the service model writes TITLE + SUMMARY in the
  conversation's language; failures are silent, a manual rename turns the
  feature off per chat (`chats.auto_title`), and `chats.summary` waits
  for Phase 4's memory (§14). Accounting: one `llm_runs` row per run with
  pi's real numbers; `run()` resolves with the usage rather than emitting
  a synthetic event, and the fake bridge books an honest zero (§6, §14).
  New routes: `GET /v1/providers`, `PUT|DELETE /v1/providers/:id/key`,
  `POST /v1/providers/:id/test` (§13). Wizard screen 3 is real; a chat
  with no provider links to Settings (§14).

- 1.8 (2026-07-31): Phase 2 built — the whole chat against a scripted
  `FakeAgentBridge`, no tokens spent. Chats and messages persisted (§6);
  run orchestration with one run per chat, a global queue and fallback
  titles (§5, §14); chat routes and an SSE hub authenticated by one-time
  ticket, replacing the hello-world stream (§13); and the React chat UI
  with streaming, thinking and tool cards, a queueing composer and a model
  picker (§14). Decisions recorded as they were made: the SSE ticket;
  the `run-status` event; stopping a queued run drops it from the queue
  and still reports `aborted`; tool events are folded into one record per
  call on both sides of the wire; message order breaks ties on rowid;
  `POP_AGENT_ENGINE=fake|pi`; context menus are visible buttons rather than
  long-press; and the skills selector is named the **Skill Router** (§8).
  The smoke grew to fourteen steps, now covering the stream, a tool run
  and Stop.

- 1.7 (2026-07-30): Phase 1 built — SQLite with a numbered-migration
  runner, settings and AES-256-GCM-encrypted secrets (§4, §6, §9); auth
  with HMAC session tokens, epoch, argon2id, recovery key and progressive
  lockout (§9); settings and about endpoints (§13); the React PWA with the
  setup wizard, login, recovery and settings screens served by the same
  process on one port (§14); and an end-to-end smoke in the gate (§18).
  Decisions recorded here as they were made: password 10–128 with no
  composition rules; the recovery-key alphabet without confusable
  characters, case-insensitive input and rejection sampling; recovery
  spends the key and issues a new one; "Sign out other devices" keeps the
  acting device signed in; sliding session renewal via `x-pop-agent-token`;
  settings PUT is a strict full replace; the theme belongs to the device
  and never reaches the server; narrow layouts follow the Telegram model
  instead of a drawer; and HTTPS is documented as two scenarios (§18) —
  public VPS with Let's Encrypt, or `tailscale serve` where the line
  blocks inbound 80/443.

- 1.6 (2026-07-30): default port is 8787 — one single port on the test
  server until HTTPS (443 via Caddy) lands; the placeholder hello page
  hands 8787 over to Pop Agent (§4).

- 1.5 (2026-07-30): development moves onto the test server — the agent
  codes, gates and runs everything on ubuntu-home over SSH; nothing
  executes on the maintainer's machines (§20).
- 1.4 (2026-07-30): backend is 100% clean architecture (§3) — aw's layer
  model ported (domain / application / infrastructure / interface, DTOs in
  `shared/`, composition root in main.ts), with the boundary test enforcing
  the dependency rule and inner-layer purity in the gate; section paths
  updated (§5, §7, §10–12).
- 1.3 (2026-07-30): repo bootstrapped on the Windows dev machine (Mac has
  npm blocked); §20 dev environment updated; WebAuthn routes added to §13.
- 1.2 (2026-07-30): biometric unlock via WebAuthn/passkey added to §9
  (maintainer's addition to the design notes, consolidated here), slotted
  into the v0.2 roadmap; §19 updated.
- 1.1 (2026-07-30): update model redesigned (§15) — two channels (pi from
  npm, Pop Agent from its repo) sharing last-known-good pinning, a post-update
  smoke gate, automatic rollback with self-disabling auto-update + user
  notification, and a 24h probation window for pi; `pop update` joins
  the CLI (§17).
- 1.0 (2026-07-30): first consolidated spec — extracted from the three
  vault notes (Visão e Escopo, Backend, Frontend) and the 60 alignment
  answers (rounds 1–3).
