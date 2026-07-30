# popy.spec — the project specification

Version 1.6 — 2026-07-30.
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
  `POPY_BIND` (default `127.0.0.1`), `POPY_DATA_DIR`, `POPY_WORKSPACE`.
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
  default 20; excess queues with visible status. Idle sessions unload from
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
chats(id, title, model, archived, pi_session_id, created_at, updated_at)
messages(id, chat_id, role, content, thinking, tools_json,
         attachments_json, created_at)
messages_fts      -- FTS5 external-content table over messages.content
messages_vec      -- sqlite-vec embeddings (message-level)
chat_titles(chat_id, title, source, created_at)
user_memory(doc, backup, last_condensed_at)     -- single-row living doc
settings(key, value)                            -- JSON per key
secrets(key, value_encrypted)                   -- §9, secret.key encrypted
llm_runs(id, chat_id, provider, model, tokens_in, tokens_out,
         cost, created_at)                      -- cost accounting (§14)
skills_index(skill_id, name, description, source, embedding)  -- §8
```

- IDs: aw's scheme — `chat-` + 12 hex, `msg-` + 16 hex, etc., from a CSPRNG.
- Attachments live on disk (`attachments/`), DB stores metadata. 16 MB cap.

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
3. **Long-chat compaction** — check pi's native auto-compaction first; only
   build our own (`[popy compacted]` summary + recent tail) if pi's isn't
   enough.

## 8. Skills with local mini-RAG selection ⭐

Popy ships dozens of built-in skills but injects only the relevant ones per
user message — selection is 100% local, no LLM call:

- Skill format: markdown with `name` + `description` frontmatter,
  compatible with pi's SKILL.md. Built-ins live in the repo; user skills in
  `POPY_DATA_DIR/skills/`.
- pi's native behavior (progressive disclosure: ALL descriptions in the
  system prompt) does not scale to dozens of skills and models often skip
  reading them. Popy's selector replaces it.
- Selector: description embeddings (same local model) in sqlite-vec + FTS5
  hybrid; each user message → similarity → score cutoff + top-k → only the
  selected skills enter that turn's context.
- Verify while coding: whether the SDK can scope which skills pi exposes
  per session/turn; if not, Popy injects the selected skills as its own
  context and disables pi's native listing.

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

## 10. External-content safety (`domain/safety/`)

Mandatory because the agent runs full-power (§5). Deterministic layer (no
LLM) over everything from outside — web, files, notes, tool output:

- Strip invisible characters (zero-width, bidi, tag chars); NFC
  normalization; flag long base64 blobs; extract URLs.
- Multilingual prompt-injection regex table (PT included; aw's table as
  conceptual reference, rewritten).
- Untrusted-data envelope with delimiters ("data, never instructions").
- **Per-turn taint**: if a turn consumed suspicious external content,
  subsequent sensitive actions (dangerous shell, note writes) require
  inline UI confirmation (Allow / Deny in the chat). This is the ONLY
  brake on yolo mode.

## 11. Notes (`infrastructure/notes/`)

Popy owns its notes: a vault of plain markdown files at
`POPY_DATA_DIR/notes/`, created and maintained by the agent. No external
vault integration — Obsidian-compatible by being plain .md; users may
sync/open it externally.

- Agent tools: `notes_list`, `notes_read` (size cap), `notes_search`
  (snippets + file-count guard), `notes_write`.
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
`GET|PUT /v1/settings`, `GET /v1/models`, `GET|PUT /v1/memory`,
`GET /v1/usage` (§14), `GET /v1/backups` (§16), `GET /v1/update/status`,
`POST /v1/update/apply`, `GET /v1/ax` (§18), `GET /healthz` (no auth).
WebAuthn: `POST /v1/auth/webauthn/register`, `POST /v1/auth/webauthn/login`
(§9, v0.2).

`GET|PUT /v1/settings` is a **full replace**: PUT carries the whole
document and the schema is strict, so a field Popy does not know is a 400
rather than something silently dropped. Public (no session):
`auth/state`, `setup`, `login`, `auth/recover`, `healthz` — and
`/v1/events`, until Phase 2 decides how to authenticate a stream that
EventSource cannot attach a header to. Any response may carry a refreshed
`x-popy-token` (§9).

SSE events (typed in `shared/`): `delta`, `thinking`, `tool` (with
start/output/done/error — `output` streams stdout in real time), `done`,
`error`, `title`, `update`. Every run has a `runId`; the frontend discards
events from stale runs.

## 14. Frontend rules (web/)

- The React app only paints. No business rules. Components never call
  `fetch`/`EventSource` — only `web/src/services/*` does (enforced by
  ESLint restricted-imports; gate fails otherwise). Types come from
  `shared/`, never redefined.
- Layout: ChatGPT-style without inventing — sidebar (chats, filter, New,
  archived), central column, composer. **Narrow screens follow the
  Telegram model rather than a drawer**: the list *is* the screen, and
  opening something is a route change, so the phone's back gesture means
  what the user expects.
- **Never a side drawer/panel for forms** (permanent veto). Settings is a
  full-screen view: General, Appearance, Model, Memory, Notes, Web Access,
  API, Usage, Backup, Updates, About. Every Save has a Cancel.
- Rendering v0.1: markdown (react-markdown + remark-gfm, sanitized, no raw
  HTML) + code highlight (Shiki, themes synced light/dark, copy button,
  language label). Mermaid/KaTeX: later.
- Streaming UX (aw's machine as reference): runId registry, reload
  reconciliation mid-run, polite autoscroll + "jump to latest", visible
  message queue during a run, per-chat draft in localStorage, auto-title
  via SSE.
- Thinking: collapsed streaming card. Tool calls: card per call with
  real-time output; consecutive calls group. Sensitive-action confirmation
  renders inline in the chat (§10).
- Auto-title: aw's scheme — first title at the 3rd user turn, regenerate
  every 10 turns, chat's own model, TITLE+SUMMARY prompt in the
  conversation's language, LLM-less fallback (4 words, PT/EN stop-words),
  dedup suffix, manual rename disables auto forever.
- **Usage dashboard** (Settings → Usage): full cost control from
  `llm_runs` — per day, per provider, per model, per conversation.
- Files the agent creates: download link in chat when a tool reports a
  file + a workspace file browser.
- Slash commands: `/model`, `/new`, `/memory`; extensible menu on `/`.
- Voice (v0.2): aw's pipeline copied as-is — MediaRecorder → upload →
  ffmpeg (WAV 16k mono) → whisper.cpp (`whisper-cli`, `tiny` default,
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
- Theme: follows the system (`prefers-color-scheme`) + manual
  System/Light/Dark override. **Never sent to the server** — it belongs to
  the device, lives in `localStorage`, and is applied by an inline script
  before the first paint so the wrong colours never flash. Two token maps;
  regression test: every theme defines every token. App icon: friendly mascot, designed later — v0.1
  ships a simple placeholder.
- PWA: app-shell precache; API/SSE never cached; SW update prompt. iOS:
  HTTPS required, safe-areas, `dvh`. Android: WebAPK via manifest. Offline
  is honest: shell + "Popy is offline". Web Push in v0.2 — exactly two
  triggers: "run finished" and "agent needs confirmation".

## 15. Providers, models, updates

- Multi-provider, aw's design as reference: OpenRouter (api key — default
  provider, **default model: Kimi K3**), GitHub Copilot (OAuth device
  code), OpenAI subscription/Codex (OAuth browser PKCE), OpenAI api key,
  Azure OpenAI, custom OpenAI-compatible. Verify what pi supports natively;
  port aw's OAuth flows conceptually for the rest.
- Service model (titles, condensation, summaries): Kimi K3 for everything
  initially.
- Model catalog: live fetch per provider with cache; static fallback.

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

## Changelog

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
