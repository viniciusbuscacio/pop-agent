# popy.spec — the project specification

Version 1.55 — 2026-08-04.
This file is the single source of truth for Popy. AGENTS.md (and CLAUDE.md,
which imports it) directs here. When a working session produces a new rule or
decision, it lands in this file. History and the "why" live in the
maintainer's notes outside the repo; this file records only the current
normative state.

> Inspired by go-apps.spec, but Popy is NOT part of the go-apps family —
> this spec is independent.

## 1. What Popy is

- A self-hosted personal agent platform: clone from GitHub, deploy on a
  VPS, and your personal agent is live — reachable from any browser as a
  PWA (desktop and mobile).
- **Single user per installation.** A second person runs a second instance
  on another port. This is a permanent design constraint, not a v1 shortcut.
- The engine is the **pi agent** (https://pi.dev), embedded in-process via
  its TypeScript SDK. Popy is the product around it: auth, chats, memory,
  notes, skills, costs, backup, PWA.
- License MIT. Repo private until the maintainer opens it. Repo is 100%
  English — code, comments, tests, docs, UI strings, commits. npm package
  name, if ever published: `popy-agent` (the unscoped `popy` is squatted).
- **Zero telemetry, no phone-home** — declared in the README. The only
  outbound traffic: LLM/provider calls and the opt-in update check.

## 2. Stack

- **Backend**: Node.js 22 LTS, TypeScript strict, pure ESM. HTTP: Hono
  (fallback candidate: Fastify — decide at skeleton time; nothing else
  depends on it). Validation: Zod at the borders. Logs: pino (JSON in
  prod, pretty in dev; never log message content in prod).
- **Database**: SQLite via `better-sqlite3`, WAL mode, FTS5 + `sqlite-vec`
  in the same file. Embeddings computed locally in-process:
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
popy/
├── popy.spec              # this file — source of truth
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
│   │   ├── notes/         #   Popy's own notes vault (§11)
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

## 4. Runtime data (`POPY_DATA_DIR`, default `~/.popy/`)

```
~/.popy/
├── popy.db          # SQLite: product data (§6)
├── secret.key       # 0600 — encrypts stored provider secrets; NEVER in backups
├── sessions/        # pi's JSONL session files (pi-owned, never parsed by Popy)
├── attachments/     # uploaded files (metadata in DB)
├── notes/           # Popy's own markdown notes vault (§11)
├── skills/          # user-added skills (§8)
└── backups/         # tar.gz snapshots (§16)
```

- `.env`: `OPENROUTER_API_KEY` optional seed, `POPY_PORT` (default 8787),
  `POPY_BIND` (default `127.0.0.1`), `POPY_DATA_DIR`, `POPY_WORKSPACE`,
  `POPY_AGENT` (`fake` | `pi`; `fake` is the scripted bridge used to build and
  test the chat without spending tokens).
  The session HMAC secret is **not** an environment variable: it is
  generated at setup and kept in the encrypted `secrets` table (§9), so a
  leaked backup -- which excludes `secret.key` -- cannot forge a token.
- `POPY_WORKSPACE` (default `~/popy-workspace/`): the single root directory
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
  context the model sees. Popy never parses those files. Popy's SQLite is
  the *product state*: chat list, titles, rendered messages, search,
  memory. Messages exist in both places on purpose — a pi format change
  must never touch the UI or memory.
- pi's `sessionDir` points into `POPY_DATA_DIR/sessions/`
  (`SessionManager.create(cwd, sessionDir)`). Resume =
  `SessionManager.open(path)` with the path stored in
  `chats.pi_session_id`. Smoke tests use `SessionManager.inMemory()`.
- **Tools**: read, bash, edit, write — all enabled, full power ("yolo
  mode"). No permission prompts. The only gate is the taint rule (§10).
  Popy's own capabilities (memory, notes, web, skills) are registered as pi
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

Single file `popy.db`. Migrations numbered, run at boot.

```sql
chats(id, title, model, archived, pi_session_id, summary, auto_title,
      created_at, updated_at)
messages(id, chat_id, role, content, thinking, tools_json,
         attachments_json, created_at)
messages_fts      -- FTS5 external-content table over messages.content
messages_vec      -- sqlite-vec embeddings (message-level)
chat_titles(chat_id, title, turn, source, created_at)  -- append-only, §14
user_memory(doc, backup, last_condensed_at)     -- single-row living doc
settings(key, value)                            -- JSON per key
secrets(key, value_encrypted)                   -- §9, secret.key encrypted
llm_runs(id, chat_id, provider, model, tokens_in, tokens_out,
         cost, created_at)                      -- cost accounting (§14)
skills_index(skill_id, name, description, source, embedding)  -- §8
artifacts(id, chat_id, name, mime, size, version, source,
          created_at, updated_at)              -- §14, RF-001
```

- **IDs and internal file names** — two shapes, one CSPRNG generator (11 base62
  chars ≈ 65 bits, drawn by rejection sampling so there is no modulo bias):
  - **Entity id** = `prefix-<11 base62>` with a full-word prefix and a hyphen:
    `chat-Hq8Lm2XcN5R`, `message-…`, `run-…`, `file-…`. Nothing about the
    install leaks through an id. On a primary-key collision (astronomically
    unlikely, but defined) the repo re-draws the id and retries once — it never
    fails the request or overwrites.
  - **Internal file** = `prefix_<11 base62>.ext` with an underscore, for files
    Popy makes itself (`audio_2f9FmGo58Jm.wav`, `text_…`). Created with an
    exclusive flag; on `EEXIST` it re-draws. The user's own files (attachments,
    notes) keep their names — the convention is for Popy's internal artifacts.
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
  `POPY_WORKSPACE/attachments/<chatId>/` so the agent's tools can open it.
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
- **Artifacts** are files the agent produced or the user uploaded, tracked per
  chat and downloadable through a signed link (§14). The bytes live on disk
  under `POPY_DATA_DIR/artifacts/<chatId>/<id>`; the row is the record. The
  `file-<11 base62>` id is the only identifier that leaves the server — no
  filesystem path or storage key is ever exposed. Deleting a chat deletes its
  artifacts (rows by cascade, bytes by removing `artifacts/<chatId>/`).

## 7. Infinite memory (`application/memory/`)

Hybrid search from day one: FTS5 (lexical) + sqlite-vec (semantic), fused
with RRF. Three layers, aw's design rewritten:

1. **History search** — agent tools `memory_search(query)` (hits grouped by
   conversation, ≤3 snippets + context), `memory_open(chatId)`,
   `memory_recent()`. A catalog of recent conversations + summaries is
   injected into the system prompt inside untrusted-data delimiters.
2. **Living user document** — one markdown doc of durable facts. The agent
   updates it via tool; ~8k chars cap in prompt; above ~6k an LLM condenses
   (max 1×/day, one-level backup, secret-scrub before persisting).
   Editable in Settings → Memory. Ships EMPTY — no personal seed; Popy is
   a product for anyone to deploy.
3. **Long-chat compaction & restore** (aw's layered design, adapted 01/08 —
   pi ALREADY does the heavy lifting, Popy wraps the policy):
   - **Compaction = pi's native auto-compaction**, explicitly configured via
     `SettingsManager` (before 01/08 it ran on implicit defaults):
     `contextTokens > contextWindow - reserveTokens` (reserve 16384,
     keepRecent 20k) → pi summarizes the old span with iterative context
     (previous summary composes in), cuts at turn boundaries (never inside a
     tool pair), and persists a `CompactionEntry` in the session JSONL.
     Popy builds no summarizer of her own.
   - **Proactive trigger**: pi's own threshold check before each turn.
   - **Reactive trigger = Popy's layer**: pi does NOT retry on a
     context-overflow error (its `retry.*` covers transient failures only).
     The bridge catches an overflow error, calls `session.compact()` and
     retries the SAME turn once — token accounting always errs a little,
     this is the safety net.
   - **Summary authority**: model-generated text never returns with system
     authority. Pi renders its summary as conversation context (verified
     01/08); anything Popy adds herself follows the house pattern — inside
     the untrusted-data envelope, never bare system.
   - **Restore after restart/idle-unload = pi's session resume** (replays
     the JSONL honouring compaction entries), plus Popy's **continuity
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
   filename the agent had no way to see (`popy skills: none` in the log),
   and it went to the web instead of its own files_search.

## 8. Skills with local mini-RAG selection ⭐ (the **Skill Router**)

Popy ships dozens of built-in skills but injects only the relevant ones per
user message — selection is 100% local, no LLM call:

- Skill format: two coexisting shapes in `POPY_DATA_DIR/skills/` —
  (a) the original flat `<slug>.md` with `name` + `description` +
  `whenToUse` frontmatter (built-ins seeded from the repo keep this), and
  (b) the **Agent Skills standard** (agentskills.io): a directory holding
  a `SKILL.md`, discovered recursively (a skill directory's inner folders
  are assets, not skills). Slug = directory name; `whenToUse` falls back
  to `description`. Flat wins on a slug collision. Decided 01/08: the
  ecosystem converged on the standard and **pi implements it natively**,
  so Popy adopts it in her own scanner rather than patching/translating
  pi (a patch would break on every pi update). New self-authored skills
  prefer the folder shape; both shapes route identically.
- **Skill language**: skills the agent writes for itself are English —
  name, slug, frontmatter, body — same rule as the repo. Skills the end
  user uploads may be in any language; the router's semantic leg is
  multilingual and the lexical leg leans on translation-stable tokens.
- pi's native behavior (progressive disclosure: ALL descriptions in the
  system prompt) does not scale to dozens of skills and models often skip
  reading them. Popy's selector replaces it.
- Selector: description embeddings (same local model) in sqlite-vec + FTS5
  hybrid; each user message → similarity → score cutoff + top-k → only the
  selected skills enter that turn's context.
- Verify while coding: whether the SDK can scope which skills pi exposes
  per session/turn; if not, Popy injects the selected skills as its own
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
  skills were selected and with what scores (pino, debug level). Router
  thresholds — including the semantic-similarity floor — are tuned from
  these logged distributions, never guessed: e5-family embeddings compress
  cosine similarity into a narrow band (unrelated pairs often score
  0.70–0.80), so intuitions like "0.75 is too strict" do not transfer.
- **PT/EN routing gap.** User messages arrive in Portuguese; skill
  descriptions are English (repo language rule). `whenToUse` texts must
  carry translation-stable trigger tokens ("typescript", "stack", "skill",
  "architecture"…), and real PT dialogues that misrouted become router
  test cases.
- **`self-architecture` skill** (routed, not pinned): the deep self-map —
  clean-architecture layers and the dependency rule, the monorepo layout,
  where Popy's own source lives on the server (Popy has bash; it can read
  its own code once it knows the path), and the decision rule: **Popy's
  extensions are TypeScript on Popy's own runtime**. The repo-map section
  is **generated from the code by a script** (runs with the gate), never
  hand-written — the spec stays the normative source; the map is derived.
- **UI map (navigation self-knowledge).** The agent runs server-side: it
  has no browser, no DOM, no accessibility (AX) tree of the PWA it fronts
  — a live AX tree exists only in the user's browser, out of reach by
  design. The equivalent knowledge is static and derivable: router paths
  in `web/src/App.tsx` and every visible label in `web/src/i18n/en.ts`
  are the source of truth for screens, menus and Settings sections. The
  self-map generator therefore also emits a **UI map** — routes, Settings
  sections, what each does — so Popy directs the user through its own
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
  over 24h old comes back refreshed in the `x-popy-token` response header
  and the client swaps what it stored — somebody who opens Popy weekly
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
  `~/.popy/secret.key` (0600), which is **excluded from backups** — a
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
  (an inline extension Popy registers; `noExtensions` still keeps the
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

Popy owns its notes: a vault of plain markdown files at
`POPY_DATA_DIR/notes/`, created and maintained by the agent. No external
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
  (§10). pi has NO native web tools (confirmed) — this is a Popy custom
  tool.
- Later: `web_search` (engine TBD) and Playwright for dynamic pages.

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
document and the schema is strict, so a field Popy does not know is a 400
rather than something silently dropped. Public (no session):
`auth/state`, `setup`, `login`, `auth/recover`, `healthz`, `health` — and
`/v1/events`, until Phase 2 decides how to authenticate a stream that
EventSource cannot attach a header to. Any response may carry a refreshed
`x-popy-token` (§9).

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
  reconciliation mid-run, polite autoscroll + "jump to latest", visible
  message queue during a run, per-chat draft in localStorage, auto-title
  via SSE.
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
  (lowest free N among the living chats). The first user message renames a
  still-generic chat immediately, with no model involved (stop-word scheme,
  PT/EN, title-cased, de-duplicated case-insensitively with " 2", " 3"…).
  The fallback is also what runs when the provider is down, out of credit or
  not configured. Once a provider exists the LLM title takes over on top of
  it:
- Auto-title (LLM): aw's scheme — ONE call writes TITLE (≤40 chars) +
  SUMMARY together; first title at the 3rd user turn, regenerate every 10
  turns, service model, prompt in the conversation's language, tolerant
  parse (<2 chars = failure), LLM-less fallback (4 words, PT/EN stop-words),
  manual rename disables auto forever (a rename by the agent does NOT).
  Every skip logs its reason (manual-rename, cadence, same-title…) so "why
  didn't it rename?" is one log line. The summary lands on the chat row and
  feeds the recent-chats catalog (§7.1) — infinite chats stay indexed.
  `chat_titles` is append-only: every title, its user turn, auto|manual.
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
- Theme: follows the system (`prefers-color-scheme`) + manual
  System/Light/Dark override. **Never sent to the server** — it belongs to
  the device, lives in `localStorage`, and is applied by an inline script
  before the first paint so the wrong colours never flash. Two token maps;
  regression test: every theme defines every token. App icon: friendly mascot, designed later — v0.1
  ships a simple placeholder.
- PWA: app-shell precache; API/SSE never cached; SW update prompt. iOS:
  HTTPS required, safe-areas, `dvh`. Android: WebAPK via manifest. Offline
  is honest: shell + "Popy is offline". Web Push in v0.2 — exactly two
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
  not a domain Apple accepts. Popy signs with a real public URL by default;
  `POPY_PUSH_SUBJECT` sets the operator's own `mailto:` or `https:` URI,
  and a value that would be rejected upstream is **dropped for the default
  rather than honoured** — a typo in an environment variable must not
  quietly switch every notification off.

### Artifacts and signed downloads (RF-001–019)

- **Artifacts** are the agent's outputs and the user's uploads, tracked per
  chat (§6 `artifacts` table). The agent produces one with the **`save_artifact`
  tool**: it writes a file in its workspace with the built-in tools, then calls
  `save_artifact(path)` to promote it into a tracked, downloadable artifact for
  the conversation (the path is jailed to the workspace). It reads one back with
  **`read_artifact(ref)`** — by id or by exact name, scoped to the current
  conversation so one chat can never read another's — which returns text content
  through the safety envelope (an artifact is external content) and reports
  binary files without inlining them. Text is extracted best-effort from
  non-text formats first (RF-011/012): **PDF** via `pdftotext`, **DOCX** via
  `unzip` of `word/document.xml`, and **images** via `tesseract` OCR (por+eng) —
  system binaries, not heavy JS deps; a failure just falls back to the binary
  note. A deploy that wants extraction installs `poppler-utils`, `tesseract-ocr`
  (+ language packs) and `unzip`. The bytes live under
  `POPY_DATA_DIR/artifacts/<chatId>/<id>`; the `file-<11 base62>` id is the
  only handle a client ever sees — no filesystem path or storage key is
  exposed. Deleting a chat deletes its artifacts (rows by cascade, bytes by
  removing the folder).
- **Downloads are HMAC-signed and public.** `GET /artifacts/:id/download?
  expires=<ms>&sig=<b64url>` carries no session — the signature is the whole
  authorisation. The signing key is derived from `secret.key` (never a fresh
  secret), so rotating the key invalidates every outstanding link. The
  signature covers the id and the expiry together, and verification checks the
  signature **before** the expiry, so tampering with `expires` fails as a bad
  signature rather than extending the link. A bad/forged signature → 403, an
  expired link → 410, an unknown id → 404. Expiry is a property of the LINK,
  not the artifact: the default life is 30 days, an expired link is refused
  even though the file still exists, a fresh link can be minted any time, and
  there is no cleanup cron.
- **Versioning and history** (RF-018/019): re-saving under the same name in the
  same chat keeps the previous bytes as a numbered version instead of losing
  them. The `artifacts` row is always the latest; `artifact_versions` is the
  trail (version, size, source, timestamp) — the audit RF-019 asks for, on a
  single-user install where the user is implied. `GET /v1/artifacts/:id/versions`
  lists the history; a specific version downloads through its own signed link
  (`/artifacts/:id/versions/:n/download`, the version folded into the signature).
- **Multimodal input** (RF-014): when the conversation's model accepts image
  input (`model.input` includes `image`), image attachments go straight to the
  model as inline content, not just saved to the workspace. Text-only models
  never receive images — they keep the file + tools path (RF-015 fallback), so
  the default model is unaffected.
- The authenticated half (`/v1`) lists a chat's artifacts, uploads a file into
  a chat (`POST /v1/chats/:chatId/artifacts`, multipart, 25 MB cap), mints a
  link and deletes one. The **artifacts screen** is a full-screen route
  (`/chat/:chatId/artifacts`, reached from the chat header) that lists, uploads,
  downloads (through a freshly minted link) and deletes — never a drawer.
  OCR, multimodal and versioning land in later blocks
  (`docs/artifacts-attachments-downloads.md`).

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
- Service model (titles, condensation, summaries): Kimi K3 for
  everything initially.

### Subscription OAuth (fase 1.5)

- **Subscription auth rides pi's own login flows** — `openai-codex`
  (ChatGPT Plus/Pro) and `github-copilot` (Copilot seat). Popy never
  reimplements an OAuth dance: `ModelRuntime.login` runs the flow and
  persists the credential into Popy's own auth file
  (`POPY_DATA_DIR/pi-auth.json`); refresh happens inside pi per
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
- **Status/resolve semantics**: for an oauth definition `configured`
  = "the engine holds a credential" (`hasConfiguredAuth`), reported as
  `source: "oauth"`; resolve treats a signed-in subscription exactly
  like a stored key when electing the pair; test uses pi `checkAuth`
  instead of the paid HTTP probe; the model catalog answers from pi's
  built-in list (no gateway, keyless). Session open for an oauth
  provider must not demand an API key.
- **The card outlives the page.** Signing in means leaving for the
  provider and coming back, and the way back is usually a fresh mount:
  a new tab, a reload, the PWA resumed from the background. The card
  therefore asks for the flow state on mount and adopts a running flow,
  instead of only knowing about flows it started itself.
- **The method choice is Popy's words, not pi's.** pi offers a
  subscription two ways and calls the browser redirect "(default)" --
  but that redirect targets `localhost:1455` on the machine doing the
  browsing, which on a self-hosted install is not the machine running
  Popy, so it can only end in a URL copied back by hand. The card
  relabels the two known methods (`device_code`, `browser`) itself and
  puts the code one -- no callback, works from any device -- first.
  Methods pi may add later render unrelabelled, as they arrive.
- **The redirect path is three steps, each said once**: open and
  approve, expect a page that does not load, paste that page's address.
  The warning comes *before* the input, because a user who meets the
  failed page unwarned reads the whole sign-in as broken and stops
  there. The steps carry the sign-in link, so the transcript drops its
  duplicate row, and the input uses Popy's own placeholder -- pi's is
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
- **An attempt may not hang** (`ATTEMPT_SILENCE_TIMEOUT_MS`, 60 s): one
  attempt that produces NOTHING — no token, no thinking, no tool — is
  aborted and the chain moves on, with code `attempt_timeout` (a
  failover class of its own, deliberately distinct from the user's
  `aborted`). Without it a dead endpoint does not fail at all: the
  socket waits on the OS TCP timeout, minutes long, and the chain never
  runs because it can only act on an error that comes back — the chat
  just sits there with no answer and no message. Any event at all
  retires the deadline; a slow first token is not a failure.
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
- **Advisory cooldown** (`ProviderCooldown`, in-memory, 5 min): a
  penalized provider is skipped by the next chains — unless every
  candidate is penalized, in which case the full chain is used anyway.
  Saving a key or completing a sign-in forgives the provider; a
  restart forgives everyone.
- **Failover is LOUD**: a persisted system message in the chat
  ("Answer retried via X after Y failed (code).") plus one journal
  line (`popy fallback: chat=… from=… to=… code=…`). Every billed
  attempt books its own `llm_runs` row (failover attempts under
  `<runId>-f<n>`), so the accounting shows what each provider really
  charged.
- Still future: a user-editable priority order (today the order is the
  definition list with the default first).

### Updates — two channels, one discipline

Both channels: manual always available, auto opt-in (default OFF, no
unasked network calls), versions pinned exactly, a recorded
**last-known-good**, and a **post-update smoke gate** before the new
version is accepted.

**pi channel** (npm, the sensitive one — a pi release can break Popy):

1. Daily semver check against npm (when auto-check is on); SSE banner;
   install = `npm install @earendil-works/pi-coding-agent@<v> --save-exact`
   after draining running runs.
2. Before activating: run the **update gate** — the smoke suite against
   the new version (in-memory session + fake provider: create session,
   run a turn, event shapes, custom-tool registration, abort) plus an SDK
   contract check (every API Popy imports still exists). Zero tokens.
3. Gate passes → version activates and becomes last-known-good. Gate
   fails (or the bridge fails to boot) → **automatic rollback** to
   last-known-good, **auto-update disables itself**, and the user is
   notified (banner + SSE; push when v0.2 lands): "pi X broke Popy,
   rolled back to Y, auto-update off until you re-enable it."
4. **Probation**: a version that passes the gate stays on probation for
   24h; if the pi bridge crashes repeatedly (threshold N) during
   probation → same rollback + disable + notify path.
5. `POST /v1/update/apply {version}` accepts any exact version = manual
   pin or manual rollback.

**Popy channel** (its own repo):

- Settings → Updates gains a "Popy" card: checks the repo's release tags,
  shows changelog link. Update = fetch tag → `npm ci` → build → smoke —
  all **before** restarting; failure reverts the checkout and the running
  server never stopped. Success → systemd restart into the new version.
- CLI: `popy update [--to vX.Y.Z]` does the same from the shell;
  `--to` on an older tag = rollback.
- Plain `git pull && npm ci && npm run build && restart` remains
  documented for hands-on users.

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

- Automatic snapshots: tar.gz of `POPY_DATA_DIR` (minus `secret.key`,
  minus `backups/` itself), consistent SQLite copy via the backup API
  (never a raw copy of a hot WAL db). Retention: daily × 7 + weekly × 4
  (tunable). Settings → Backup lists snapshots for download.
- **Restore only with the server stopped**: `popy restore <file>`. Never
  over a running server. Restore UI: maybe later.

## 17. CLI

`popy start | backup | restore <file> | update [--to vX.Y.Z] |
reset-password | access-list <add|remove|list|clean>`. `reset-password`
covers "forgot password AND recovery key" for whoever has shell.
`access-list clean` is the maintenance escape hatch for §18 lockouts.

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
  lock yourself out: `popy access-list clean` over SSH.
- Control plane `GET /v1/ax`: describes the app for agents (route map,
  error contract, action catalog with risk levels), own X-API-Key separate
  from user sessions, OFF by default. `tools/smoke.ts` starts the server as its
  own process with a temp `POPY_DATA_DIR` on an ephemeral port and drives
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
  LAN / tailnet), codes in the clone at `~/dev/popy`, runs the gate, the
  dev server and the smoke there, and pushes to GitHub from there. The
  Windows ThinkPad is only the terminal (and holds a read-only mirror
  clone); the Mac has npm blocked by corporate policy. UI testing: the
  agent drives a browser (Chrome DevTools) against the server's URL —
  same interface the maintainer uses. Production target: any Linux with
  systemd + Node 22 (`npm run build` + systemd unit example in repo).
  Docker: maybe later, never required.
- The test server runs the dev build under **systemd**
  (`deploy/popy-dev.service`: sources through tsx, absolute `ExecStart`
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
  manual-rename path** (which switches `auto_title` off, so neither the
  deterministic first-message fallback nor the service model will ever
  rewrite a name the user chose — §14), post the prompt as a user message,
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
  - `POPY_WORKSPACE/attachments/<chatId>/` whose chat is no longer in the
    database. A chat deleted through the API already takes its folder with it
    (§6); this catches what a crash, a restore or a hand-edited database left.
  - Scratch files sitting **directly** in the workspace root, older than thirty
    days, and only with an extension the agent is known to leave behind:
    `.png`, `.yaml`, `.mjs`.
- The list of what it must never do is longer than what it does: never the
  attachments of a living chat, never the database, never a directory in the
  workspace root (that is someone's project), never anything outside
  `POPY_WORKSPACE`, never a symlink. **Session history is forever** — a sweep
  only ever removes files *derived* from it, never a message, a chat or a
  title. Deletion failures are swallowed: a file already gone is the goal.
- One journal line per sweep, with the counts, even when both are zero — a
  silent job is a job nobody can tell is alive.

## Changelog

- 1.55 (2026-08-04): **Providers are added, not configured (§14, §15).** The
  Model screen used to show every provider Popy knows about, configured or
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
  background behaviour, not a provider.
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
  Popy runs on a phone, so the gesture every phone user knows was simply
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
  markup rendered inline on Popy's own origin can read the session token;
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
  the bar. The card now names the choice in Popy's own words with the
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
  iPhone, because the VAPID `sub` claim was `mailto:popy@localhost` and
  Apple validates it: measured against web.push.apple.com, that subject
  answers 403 `BadJwtToken` while a real public URL answers 201. Popy now
  signs with its own project URL by default, `POPY_PUSH_SUBJECT` takes an
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
  never anything outside POPY_WORKSPACE, never the database. One journal
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
  in the chat + `popy fallback:` journal line; every billed attempt
  books its own `llm_runs` row (`<runId>-f<n>` for retries). Context
  overflow keeps its §7 compact-and-retry path, same provider.
- 1.34 (2026-08-01): **Subscription providers via OAuth (§15, fase
  1.5).** `openai-codex` (ChatGPT subscription) and `github-copilot`
  (Copilot subscription) join the declarative list with
  `authType: "oauth"`. pi's `ModelRuntime.login` runs the whole flow;
  Popy adds a single-active `OAuthFlowService` (10-minute timeout, new
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
  `npm run ui:crawl` (tools/ui-crawl.ts) boots a throwaway popy (temp
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
  at 6.54 for the auto-programming question and Popy answered TypeScript
  with the platform's own reasons.

- 1.27 (2026-07-31): **Self-knowledge hardening built (§8).** Skills carry a
  `pinned` flag (frontmatter, DTO, save schema); the router skips pinned
  skills and their bodies lead the session system prompt through the
  bridge's instructions string, which already reopens a session when it
  changes — so a pin edit reaches the next run. know-thyself ships pinned,
  and is pinned by code even where a v0.2 file predates the flag. The
  router service reports every selection and main logs
  `popy skills: <slug>=<score> …` — slugs and scores only, never message
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
  `web/src/i18n/en.ts`) so Popy can guide the user through its own
  screens. Design recorded; implementation pending with 1.25.

- 1.25 (2026-07-31): **Self-knowledge hardening (§8) — design recorded,
  implementation pending.** Motivated by a real PT dialogue where the
  router never surfaced know-thyself and Popy recommended Python for its
  own extensions. Four rules land in §8: skills can be **pinned** into the
  session system prompt (know-thyself ships pinned; pinned set stays
  tiny); the router **logs selections and scores** per turn, and
  thresholds are tuned from those logs (e5 similarity is band-compressed
  — do not eyeball the floor); `whenToUse` carries translation-stable
  PT/EN trigger tokens, with misrouted real dialogues as test cases; and a
  routed **self-architecture** skill carries the deep map — layers,
  dependency rule, where the source lives, "Popy's extensions are
  TypeScript on Popy's runtime" — with its repo-map section generated by a
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
  Appearance), the Popy server card reading the latest origin tag with
  the update command shown (the **notify-only** channel: one push per new
  version, deep-linking to ?section=updates; applying stays a shell act),
  and an Environment card (pi/node/ffmpeg/poppler/tesseract/whisper
  versions, visibility only). GET /v1/artifacts (all chats) joins §13.
  Fixes shipped same day: DELETE responses parse (204), unarchive
  refreshes both lists, composer scrollbar only at its cap, the update
  Reload button reloads unconditionally, voice model default small on
  this hardware (medium measured 5.8x realtime on 4 cores).

- 1.12 (2026-07-31): **v0.2 built, tagged v0.2.0.** Skills + the Skill
  Router (§8): markdown skills under POPY_DATA_DIR/skills, a pure lexical
  router that prepends the relevant few per turn, 15 defaults led by
  know-thyself, a full-screen CRUD in Settings. Backup/restore as tar.gz
  with the key excluded (§16). Web Push when a run finishes, VAPID keys in
  the secrets table (§14). Passkeys via WebAuthn for Face ID unlock (§9).
  Local voice already shipped in 1.10. Cost dashboard over llm_runs (§14).
  Two decisions recorded here: **attachments extraction** — Popy does not
  bundle a PDF/DOCX/OCR pipeline like aw; attachments are written into the
  agent's workspace and the agent extracts what it needs with its own
  tools (pdftotext, unzip, its reader), which fits Popy's "agent with real
  fs" design where aw's server-side extraction fit its tool-less desktop
  app. **Update channel** (§15): Popy does not self-update from the running
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
  pressure (SessionCompactEvent), so Popy builds nothing and inherits it.

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
  the coding persona with Popy's neutral prompt and disables pi's CLI
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
  `POPY_AGENT=fake|pi`; context menus are visible buttons rather than
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
  acting device signed in; sliding session renewal via `x-popy-token`;
  settings PUT is a strict full replace; the theme belongs to the device
  and never reaches the server; narrow layouts follow the Telegram model
  instead of a drawer; and HTTPS is documented as two scenarios (§18) —
  public VPS with Let's Encrypt, or `tailscale serve` where the line
  blocks inbound 80/443.

- 1.6 (2026-07-30): default port is 8787 — one single port on the test
  server until HTTPS (443 via Caddy) lands; the placeholder hello page
  hands 8787 over to Popy (§4).

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
  npm, Popy from its repo) sharing last-known-good pinning, a post-update
  smoke gate, automatic rollback with self-disabling auto-update + user
  notification, and a 24h probation window for pi; `popy update` joins
  the CLI (§17).
- 1.0 (2026-07-30): first consolidated spec — extracted from the three
  vault notes (Visão e Escopo, Backend, Frontend) and the 60 alignment
  answers (rounds 1–3).
