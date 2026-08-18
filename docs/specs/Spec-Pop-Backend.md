# Pop Agent — backend and database

**Status:** normative
**Legacy coverage:** §6
**Primary implementation:** `server/src`, `shared/src`, `server/migrations`
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.

## Scope

The backend is the single-owner Pop Agent server: a strict TypeScript/Node
process that owns product policy, durable state, agent orchestration and every
remote-client interface. It serves the HTTP API, session-wide SSE stream, built
PWA, CLI artifacts and optional PLA transport from one composition root.

This document governs:

- server-side clean architecture and dependency direction;
- process composition and lifecycle;
- application ports and infrastructure adapters;
- SQLite ownership, migrations, transactions and query invariants;
- durable chat/message representation, identifiers and deletion;
- integrity, recovery, performance and backend test obligations.

Focused specifications retain their own detail:

- pi sessions, tools, model turns and process abort:
  [Spec-Pop-Pi-Agent-Integration.md](Spec-Pop-Pi-Agent-Integration.md);
- HTTP resources, errors and route authorization: [Spec-Pop-API.md](Spec-Pop-API.md);
- SSE ordering, snapshots and reconnect: [Spec-Pop-Events-Synchronization.md](Spec-Pop-Events-Synchronization.md);
- providers and models: [Spec-Pop-Providers-and-Models.md](Spec-Pop-Providers-and-Models.md);
- memory, Notes, Files storage and backup: [Spec-Pop-Memory-and-Storage.md](Spec-Pop-Memory-and-Storage.md);
- skills and tools: [Spec-Pop-Skills-and-Tools.md](Spec-Pop-Skills-and-Tools.md);
- outbound A2A client and persisted foreground remote tasks:
  [Spec-Pop-A2A.md](Spec-Pop-A2A.md);
- auth, encrypted secrets and external-content safety: [Spec-Pop-Security.md](Spec-Pop-Security.md);
- scheduled work: [Spec-Pop-Background-Tasks.md](Spec-Pop-Background-Tasks.md).

The backend knows pi through application-owned ports. It does not make pi-owned
JSONL part of SQLite, parse those sessions or duplicate pi behavior in product
services.

## Runtime and process model

- Production code is strict TypeScript, pure ESM, on the Node version required
  by the root package. Ancillary Go launchers and trays are separate processes,
  not another backend.
- There is one server process and one SQLite database per installation. The
  product is permanently single-user, but multiple authenticated devices and
  chats may be active concurrently.
- `server/src/main.ts` is the composition root and the only production module
  allowed to know the complete object graph.
- `@hono/node-server` hosts Hono. The default listener is
  `127.0.0.1:8787`; deployment decides how HTTPS reaches it.
- `POP_AGENT_ENGINE=pi` selects the real agent adapter. `fake` is the scripted,
  no-provider engine for tests and smoke. Unknown values fail boot.
- Application policy must not depend on the selected engine, HTTP framework,
  database driver, filesystem implementation or operating-system service
  manager.

### Boot sequence

Boot is fail-closed and follows this ownership order:

1. Resolve process configuration and immutable build/version paths.
2. Create the owner-only data directory.
3. Inspect any legacy Files catalog that a later migration removes.
4. Open `pop-agent.db`, enable WAL and foreign keys, and apply pending migrations.
5. Load or create the local `secret.key` and construct SQLite repositories.
6. Validate the selected pi runtime before accepting real agent work.
7. Create the workspace, Files link, vaults, infrastructure adapters and
   application services.
8. Build the Hono application from explicit dependencies.
9. Start schedulers only after composition succeeds, then listen for HTTP and
   optional PLA WebSocket upgrades.
10. Backfill local embeddings in the background after the server is reachable.

A failed prerequisite aborts boot rather than silently choosing a weaker engine,
empty database, unvalidated runtime or insecure default.

### Shutdown and restart

On `SIGTERM` or `SIGINT`, the run service synchronously persists interrupted
partial answers before process exit. Deployment uses a separate drain protocol:
it closes admission, waits for accepted runs and tasks, then lets an external
supervisor restart and health-check the committed build. Exact update behavior
belongs to the installation and deployment specifications.

## Clean architecture

```text
                        main.ts
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
    interface        infrastructure      application
        │                  │                  │
        ├──── shared       └──────┬───────────┘
        │                         ▼
        └────────────────────── domain
```

The enforced production dependency rule is:

| Layer | May depend on |
|---|---|
| `domain` | itself and Node built-ins only |
| `application` | domain and Node built-ins |
| `infrastructure` | application and domain |
| `interface` | application, domain and `@pop-agent/shared` |
| `shared` | itself and Node built-ins only |
| `main.ts` | domain, application, infrastructure, interface and shared |
| `testing` | every production layer, for explicit fixture composition |

Additional rules:

- `domain`, `application` and `shared` have no third-party production imports.
- Test files are not production dependencies.
- Production layers may not import `testing`.
- Domain entities never cross the network boundary directly.
- The interface validates wire input and maps domain/application output to
  shared DTOs.
- `shared` defines dependency-free wire shapes used by server, web and CLI; it
  contains no database, framework or domain behavior.
- The application layer owns ports because use cases define what they need.
  Infrastructure implements those ports.
- There is no service locator or implicit global dependency container.
- `server/src/architecture/boundary.test.ts` is an executable guard for these
  rules. Exceptions require an explicit architectural decision, not a casual
  allowlist entry.

## Layer responsibilities

### Domain

Domain modules hold plain entities, value objects and deterministic policy such
as IDs, chat/message shapes, safe paths, rank fusion, task schedules and safety
classification. They do not perform I/O or know Hono, pi, SQLite or Zod.

### Application

Application services orchestrate domain behavior and ports. They own product
invariants such as:

- one live run per chat and bounded global run admission;
- durable queued-input FIFO behavior;
- stop/delete ordering;
- provider failover policy;
- auth/session transitions;
- Files path and provenance rules;
- skill routing, distillation and publication policy;
- task scheduling and deployment drain.

Time, persistence, agent execution, hashing, push, transcription and external
calls enter through ports. Services use injected clocks/timers where observable
behavior depends on time.

### Infrastructure

Infrastructure adapts application ports to SQLite, pi, filesystems, providers,
MCP, outbound A2A, local models, systemd, Git and subprocesses. An adapter may
translate and retry technology-specific failures, but it must not invent product
policy. A2A protocol/transport code remains outside pi tool definitions; the
application service owns persisted task transitions and the adapter owns
SSRF-safe bounded calls, custom same-origin Agent Card resolution and dynamic
Microsoft Entra token acquisition. Azure SDK types remain infrastructure-only.

The pi adapter implements `AgentBridge` and related narrow ports. The fake
adapter implements the same application contract. Switching between them must
not alter route or persistence semantics.

### Interface

The interface owns Hono routes, authentication middleware, transport validation,
SSE, PLA transport, static asset delivery and mapping to shared DTOs. Every API
route group is mounted through the typed route registry as either:

- session-guarded; or
- an explicitly declared public surface with a written reason.

Unknown API paths return the structured error contract. Non-API paths fall
through to the built PWA only after all public and guarded API surfaces have
been mounted.

## Composition and repositories

`bootstrap()` owns only durable runtime foundations: data directory, database,
secret key and concrete repositories. `main.ts` composes those repositories
with application services and non-database adapters.

Repository interfaces are synchronous where `better-sqlite3` is synchronous.
A use case must not expose the driver handle or SQL row shapes outside the
adapter. Multi-step writes that form one invariant use a database transaction
inside the owning repository or an explicit transactional adapter operation.

Ports exist for policy isolation, testability and replacement of infrastructure;
they do not imply multi-user tenancy or a PostgreSQL roadmap.

## 6. Database (SQLite)

### Database contract

- Durable product state uses one file: `POP_AGENT_DATA_DIR/pop-agent.db`.
- `better-sqlite3` is the only database driver and no ORM is used.
- Every open enables `journal_mode=WAL` so reads can proceed around writes.
- Every open enables `foreign_keys=ON`; SQLite's disabled-by-default behavior is
  never accepted.
- Boot runs migrations before repositories serve reads or writes.
- The cheap detailed health report performs `SELECT 1` and reports DB failure
  without making a provider network call. `/healthz` remains process liveness
  only.
- SQLite is product state. Pi's JSONL is execution state. Files, Notes and
  skills have filesystem authorities described by their focused specs.

### Schema authority and inventory

The exact current schema is the ordered result of `server/migrations/*.sql`.
This document records ownership and invariants rather than duplicating every
column, which would become a second migration history.

Current durable families are:

| Family | Tables / virtual tables | Authority |
|---|---|---|
| Configuration and security | `settings`, `secrets`, `webauthn_credentials`, `push_subscriptions` | settings, encrypted credentials, passkeys and push endpoints |
| Conversations | `chats`, `messages`, `chat_titles`, `queued_messages`, `recent_models` | visible product history, chat metadata and pending input |
| Search and memory | `messages_fts`, `message_embeddings`, `user_memory` | lexical index, local vectors and living memory document |
| Usage | `llm_runs` | chat/background token and cost ledger |
| Tasks | `tasks`, `task_run_chats` | schedules, cursors, results and chats produced by tasks |
| MCP | `mcp_servers`, `mcp_capabilities` | configured servers and discovered capability cache |
| Skills | `skill_embeddings`, `skill_usage`, `skill_distillation`, `skill_revisions`, `skill_distillation_attempts`, `skill_distillation_results`, `auto_skill_publications` | routing, collection, reviews, revisions and crash-safe publication |
| Files audit | `file_provenance` | append-only history of chat writes; never Files state |
| Migration bookkeeping | `schema_migrations` | applied migration versions |

FTS5 internal shadow tables are SQLite implementation details, not product
repositories. Removed artifact-catalog tables remain visible in historical
migrations because old installations must still upgrade through that history;
they do not exist in a fresh current schema.

### Migration policy

- Migration files are immutable, zero-padded and named
  `NNN_descriptive_name.sql`.
- Versions are unique and strictly increase. The runner validates the complete
  filename/version set before changing the database.
- Pending files apply in numeric order, each inside its own transaction.
- A successful version is recorded in `schema_migrations` in the same
  transaction as its SQL.
- Re-running boot is idempotent: applied versions execute no SQL again.
- A failed migration leaves none of that migration's partial schema or data.
- A released migration is never edited, removed or renumbered. Corrections use
  a later migration that can upgrade every previously released state.
- Migrations may intentionally rebuild tables when SQLite cannot express the
  change with `ALTER TABLE`; foreign keys, indexes and triggers must be restored
  explicitly.
- A migration that removes a former storage authority must preserve an upgrade
  path for existing data. The legacy Files catalog is therefore read before
  the migration that drops it and exported to the plain Files tree afterward.
- Tests cover ordering, idempotence, incremental upgrade, malformed/duplicate
  versions, transactional failure and the shipped migration chain.

## Identifiers and internal files

Pop-generated opaque identifiers use one CSPRNG base62 generator with rejection
sampling: 11 characters, approximately 65 bits, and no installation-derived
component.

- Entity IDs are `prefix-<11 base62>`, for example `chat-…`, `message-…`,
  `run-…` and `queued-…`.
- Internal filenames are `prefix_<11 base62>.ext`, for example `audio_….wav`.
- User-owned filenames are not rewritten to this convention.
- A primary-key collision must never overwrite an entity. Repositories either
  redraw and retry atomically or reject the attempted insert without changing
  existing data.
- Internal files are claimed with exclusive creation. `EEXIST` redraws the
  random name; other filesystem errors propagate. Temporary job directories
  are private and removed in `finally` paths.

Random IDs do not define time order. Persisted ordered collections use their
explicit timestamp plus SQLite `rowid` as the insertion-order tiebreaker where
timestamps can tie.

## Conversation persistence

### Product history versus execution history

Pop Agent deliberately stores conversation information twice for different
owners:

- SQLite stores stable product history rendered by the clients, searched by
  memory and included in audits.
- Pi stores the exact execution tree, compaction and model context in JSONL.

`chats.pi_session_id` is an opaque locator handed back to the pi adapter. No
SQLite repository parses or edits the JSONL.

### Messages

- A message row stores role, answer content, thinking, folded tool records,
  attachments, optional typed system notice, client audit context and time.
- `messages.tools_json` holds one record per tool call, not one row per streamed
  event. Live events fold into the same shape that a reload reads.
- A history page is ordered by `(created_at, rowid)`. IDs are random and must
  not be used as an ordering key.
- Opening a chat reads a bounded tail page; older pages walk backward from a
  known message. The repository reverses the descending query before returning
  chronological domain messages.
- The chat list obtains its latest-message preview in the list query rather
  than issuing one query per chat.
- `messages_fts` is an external-content FTS5 index over `messages.content`,
  backfilled on creation and maintained by triggers.
- `message_embeddings` stores local `Float32Array` vectors as BLOBs keyed by
  message `rowid`. Vector search runs in JavaScript; no SQLite vector extension
  is required.
- Because an implicit `rowid` cannot be a safe foreign-key target, deleting a
  chat explicitly removes its embeddings in the same transaction before the
  chat/message cascade. FTS follows message triggers.

### Attachments

- A message may carry at most eight uploaded attachments.
- The 16 MB product limit is per uploaded attachment. Interface validation also
  bounds the encoded data URI.
- The data URI is durable message content in `attachments_json`, allowing an
  old conversation to render without a separate blob catalog.
- The pi adapter writes a tool-readable operational copy under
  `POP_AGENT_WORKSPACE/attachments/<chatId>/`.
- Deleting the chat removes that operational directory. The durable message
  copy disappears with the message row.
- Files explicitly written into the user's Files tree are separate user state
  and survive chat deletion.

## Deletion and cross-store consistency

Deleting a chat is an ordered application operation, not a raw table delete:

1. Read the chat so external locators remain available.
2. Abort its live run and drop runtime work still waiting for admission.
3. Let durable queued-message rows disappear with the chat transaction.
4. In one SQLite transaction, remove message embeddings and delete the chat;
   foreign-key cascades remove messages and dependent product rows, while FTS
   triggers remove indexed terms.
5. Emit `chat-deleted` after product state no longer contains the chat.
6. Dispose the cached pi session, remove its JSONL/sidecar and delete the
   workspace attachment directory on a best-effort basis.

The ordering prevents a still-running model/tool process from spending credit
and streaming into rows being removed. The pi adapter owns the concrete abort
mechanism; this backend contract requires that application deletion request it
before persistence disappears.

Filesystem purge is idempotent: already absent paths are success. It must remain
jailed to server-owned session and attachment locations. Chat deletion never
uses provenance to delete user Files.

## Other persistence invariants

- Settings are JSON values keyed by setting name. Application services own
  defaults and normalization; routes do not write arbitrary database rows.
- Secrets are encrypted before entering `secrets`; plaintext credentials are
  never logged or returned by repository APIs.
- `chat_titles` and `file_provenance` are append-only history. A later title,
  move or rename does not rewrite old evidence.
- `llm_runs` records provider/model usage for chat and background purposes.
  Subscription-backed runs may have zero monetary cost while retaining token
  accounting.
- Pending chat input is a durable per-chat FIFO with a high defensive cap.
  Delivery removes a row only after its corresponding user turn has been
  accepted/persisted; restart must not silently lose accepted input.
- Every admitted chat run has a SQLite journal row from the same transaction
  that stores its user turn until the transaction that stores terminal history.
  Streamed text, thinking and tool projection are persisted before broadcast.
  Boot resumes only rows still marked queued; rows marked running may already
  have external effects and are finalized as interrupted, never replayed.
- Background task and auto-skill state use durable cursors/journals so a restart
  can distinguish not-started, in-progress and completed work.
- Device connection presence is live in memory; durable permission belongs to
  settings. SQLite must not turn a stale connection row into apparent liveness.

## Failure handling and observability

- Expected application failures use typed results or errors and are mapped to
  the stable API error contract at the interface.
- Infrastructure failures preserve their cause internally but must not leak
  credentials, raw provider pages or filesystem internals to clients.
- Logs contain operational facts, IDs, stages, durations and sanitized error
  categories. They do not contain prompts, message bodies, OAuth tokens or
  secret values by default.
- There is no telemetry export. Logs remain on the owner's server unless the
  owner explicitly retrieves them.
- Background failures are caught at their scheduler boundary, recorded where
  the subsystem has durable status, and must not become unhandled process
  rejections.
- Cheap health checks do not perform paid/external calls. Provider health uses
  configuration and the last known run outcome.

## Performance rules

- Request paths use bounded pages and payload limits; unbounded reads are
  reserved for explicit maintenance operations with their own bounds.
- List endpoints avoid N+1 repository calls where one indexed query can provide
  the needed projection.
- Frequently ordered/filterable columns receive migration-owned indexes.
- SQLite transactions stay synchronous and short; model, embedding, network and
  subprocess work never runs inside a DB transaction.
- Embedding downloads and backfills occur after listen and outside request
  latency. Lexical search remains available while vector rows lag.
- SSE carries live deltas and invalidations; it is not a database event log.
  Reconnect correctness comes from fresh snapshots/revisions, not replaying
  SQLite mutations.
- Large tool streams are folded before durable message storage. Clients must not
  need to replay raw stream events to reconstruct a finished conversation.

## Backend test obligations

A backend change is incomplete without the smallest relevant tests plus the full
gate. Depending on the concern, coverage includes:

- domain unit tests for pure policy and adversarial inputs;
- application tests with fake ports for ordering, retries and failure paths;
- adapter tests against temporary SQLite databases/filesystems;
- migration tests from fresh and representative old states;
- route tests for validation, authorization and DTO mapping;
- architecture tests for dependency direction and inner-layer purity;
- pi SDK contract tests and fake-provider run tests at the adapter boundary;
- smoke through a real ephemeral HTTP server, temporary data directory and
  built frontend.

Database tests must enable foreign keys as production does and assert persisted
state after reopening where restart durability is part of the contract.
Concurrency tests use controlled clocks/timers or deferred promises rather than
sleep-based guesses.

Before completion, run `npm run gate`: specification checks, architecture/lint,
typecheck, native component checks, build, the complete test suite and smoke.
