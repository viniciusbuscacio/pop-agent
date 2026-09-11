# Pop Agent — General specification and normative index

**Status:** normative entry point
**Normative source of truth:** the specification set under `docs/specs/`
**Implementation truth:** current code and tests
**Audience:** Pop Agent itself and maintainers
**Migrated from:** the former monolithic root specification, version 2.06

## How to use this specification set

This document is the authoritative entry point for Pop Agent. General and
cross-cutting rules live here; subsystem rules live in the focused normative
specifications below. Read only the focused specifications relevant to a task,
then inspect current code and tests before changing or asserting implementation
details.

Code and tests describe what is implemented. These specifications define what
the product requires. A divergence is a defect to investigate, not permission
to silently choose one side.

## Normative specification index

| Legacy section / subject | Normative document |
|---|---|
| §§1–4 — identity, stack, repository, runtime data | this document |
| §5 — pi integration | [Spec-Pop-Pi-Agent-Integration.md](Spec-Pop-Pi-Agent-Integration.md) |
| Worker subagent delegation | [Spec-Pop-Subagents.md](Spec-Pop-Subagents.md) |
| §6 — database | [Spec-Pop-Backend.md](Spec-Pop-Backend.md) |
| §7 — memory | [Spec-Pop-Memory-and-Storage.md](Spec-Pop-Memory-and-Storage.md) |
| §8 — skills | [Spec-Pop-Skills-and-Tools.md](Spec-Pop-Skills-and-Tools.md) |
| §§9–10 — auth, secrets and external-content safety | [Spec-Pop-Security.md](Spec-Pop-Security.md) |
| §11 — Notes | [Spec-Pop-Memory-and-Storage.md](Spec-Pop-Memory-and-Storage.md) |
| §12 — web and MCP access | [Spec-Pop-Skills-and-Tools.md](Spec-Pop-Skills-and-Tools.md) |
| MCP integration ownership and pi extension boundary | [Spec-Pop-Skills-and-Tools.md](Spec-Pop-Skills-and-Tools.md) |
| REST API server and outbound clients | [Spec-Pop-REST-API.md](Spec-Pop-REST-API.md) |
| Agent2Agent (A2A) server and client | [Spec-Pop-A2A.md](Spec-Pop-A2A.md) |
| §13 — API contract | [Spec-Pop-API.md](Spec-Pop-API.md) |
| §14 — PWA/frontend | [Spec-Pop-Frontend.md](Spec-Pop-Frontend.md) |
| §15 — providers and models | [Spec-Pop-Providers-and-Models.md](Spec-Pop-Providers-and-Models.md) |
| §15 updates — server, pi, CLI and PWA update channels | [Spec-Pop-Installation.md](Spec-Pop-Installation.md) |
| §16 — backup and restore | [Spec-Pop-Memory-and-Storage.md](Spec-Pop-Memory-and-Storage.md) |
| §17 — CLI and operator CLI | [Spec-Pop-CLI.md](Spec-Pop-CLI.md) |
| §17.1 — installed PWA and optional local access | [Spec-Pop-Local-Access.md](Spec-Pop-Local-Access.md) |
| §18 — production exposure | [Spec-Pop-Deployment-and-Operations.md](Spec-Pop-Deployment-and-Operations.md) |
| §§19–20 — versioning and working conventions | this document |
| §21 — background tasks and maintenance | [Spec-Pop-Background-Tasks.md](Spec-Pop-Background-Tasks.md) |
| SSE and snapshot synchronization | [Spec-Pop-Events-Synchronization.md](Spec-Pop-Events-Synchronization.md) |
| Cache-first client synchronization | [Spec-Pop-Client-Synchronization.md](Spec-Pop-Client-Synchronization.md) |
| UI design system | [Spec-Pop-Style-Guide.md](Spec-Pop-Style-Guide.md) |
| Detailed historical decisions | [History-Pop-Spec.md](History-Pop-Spec.md) and Git history |

## Authority and maintenance

- A new cross-cutting normative decision updates this document.
- A subsystem decision updates its focused normative specification.
- A new focused specification is added to the index above.
- Volatile implementation detail should be derived from code where practical.
- Research drafts, Obsidian notes and Files documents are not normative until
  their accepted decisions are incorporated into this set.
- Historical entries are preserved as history, not mixed into current rules.
- `npm run specs:check` prevents a missing index entry, broken relative link,
  non-normative subsystem spec or return of the removed monolithic file.

## High-value paths by task

- HTTP contract: `shared/src`, application use case/port,
  `server/src/interface/http`, `web/src/services`.
- Chat run: `server/src/application/chat`,
  `server/src/infrastructure/agent`, `docs/agent-flow.md`.
- Screen: `web/src/routes`, `web/src/services`, `web/src/store`, `web/src/ui`.
- Persistent setting: application service/port, settings adapter, DTO, route
  and UI service.
- Agent tool: application policy, infrastructure registration, safety
  classification and Plan Mode tests.
- Installation/update: launcher/scripts, immutable artifacts, installation UI
  and platform tests.

## 1. What Pop Agent is

Pop Agent is a self-hosted personal agent platform. One installation belongs to
one owner and is reachable through its server from browsers, an installed PWA
and the terminal client.

Permanent product rules:

- **Single user per installation.** A second person runs a separate instance.
  This is an architectural constraint, not a temporary v1 limitation.
- **The brain stays on the server.** Pop Agent embeds pi in-process through its
  TypeScript SDK. Providers, prompts, sessions, memory, policy, accounting and
  product persistence remain server-side.
- **MCP remains a Pop-owned capability.** Pop owns MCP configuration,
  credentials, authorization, safety, lifecycle and tool projection. The
  official TypeScript MCP SDK owns protocol mechanics, and pi receives the
  resulting tools through its supported SDK APIs. Host-installed or third-party
  pi extensions are not the MCP product boundary.
- **A2A is owner-configured in both directions.** Independent Server and Client
  modules default off; inbound calls require a dedicated key and IP allowlist,
  and outbound results remain untrusted external content.
- **Clients are views and optional hands.** The PWA and CLI present the product;
  optional Pop Local Access lends explicitly selected local tools without
  creating another agent.
- **Self-hosted data ownership.** Product data remains on the owner's server
  except for traffic required by features the owner invokes or configures.
- **Zero telemetry and no analytics phone-home.** Outbound traffic is limited to
  provider/OAuth calls, explicit web or MCP use, configured update/package
  checks, push delivery and other user-requested integrations.
- **Repository language is English.** Code, comments, tests, normative specs,
  UI strings and commits are English. User content may use any language.
- **MIT license.** The package/product name is `pop-agent`.

## Core capabilities

- Authenticated multi-device chat with durable history, streaming, queues,
  steering, attachments, voice input and per-run usage.
- Multiple model providers, subscription sign-in, custom compatible endpoints,
  per-chat model selection and controlled failover.
- Conversation search, semantic retrieval and a living user-memory document.
- A shared Files tree, private Notes vault and local embeddings.
- Built-in, personal and reviewed automatic skills selected locally per turn.
- Server tools, web access, MCP and outbound A2A tools, and optional
  selected-computer tools.
- Scheduled agent tasks and internal maintenance jobs.
- PWA installation, terminal access, backups, update channels and recovery.
- Authentication, passkeys, encrypted secrets, external-content taint and
  enforced read-only Plan Mode.

## System context

```text
Browser / installed PWA ── HTTP + SSE ──┐
Pop CLI ──────────────── HTTP + SSE ────┼── Pop Agent server ── providers
PLA tray / CLI ─────── WS or polling ───┘         │
                                                   ├── SQLite product state
                                                   ├── pi JSONL sessions
                                                   ├── Files and Notes
                                                   ├── Skills and embeddings
                                                   └── update/backup state
```

HTTP carries commands and snapshots. The session-wide SSE stream carries chat
streaming and state invalidations. PLA is a distinct authenticated channel
between the server and an optional local runtime.

## State ownership

| State | Authority |
|---|---|
| Chats, messages, settings, tasks, usage and indexes | SQLite |
| Exact execution context, branches and compaction | pi-owned JSONL sessions |
| User-visible files | the plain `files/` directory |
| Pop Agent's private Markdown notes | the `notes/` vault |
| Built-in skill definitions | repository source |
| Personal and automatic skills | the `skills/` vault plus SQLite metadata |
| Live local-computer availability | the PLA connection registry |
| Local-computer permission | persistent server policy, synchronized to PLA |
| Theme, font and other device-scoped preferences | browser/device storage |
| Current implementation behavior | code and tests |
| Required product behavior | this modular specification set |

## 2. Stack

- **Runtime:** Node.js `>=22.19.0`, TypeScript strict and pure ESM.
- **Agent engine:** `@earendil-works/pi-coding-agent` pinned exactly and loaded
  through the infrastructure bridge.
- **HTTP and validation:** Hono at the interface edge, Zod for product HTTP
  payloads and TypeBox-compatible schemas for pi tools.
- **Database:** SQLite through `better-sqlite3`, WAL and FTS5. Vectors are
  `Float32Array` blobs compared in JavaScript; `sqlite-vec` is not used.
- **Embeddings:** local multilingual E5 through Transformers.js/ONNX on CPU.
- **Frontend:** React 19, React Router, Zustand, Vite, Tailwind CSS v4 over
  semantic CSS variables, and `vite-plugin-pwa`.
- **Native support:** small Go programs provide the stable `pop` launcher and
  optional local-access tray; they do not contain the agent or web UI. A separate
  Windows Wails setup uses go-installer for the local companion's installation
  wizard only; it is not a desktop wrapper for Pop Agent.
- **Tests:** Vitest, Testing Library/happy-dom, Go tests, contract probes and an
  end-to-end smoke server with a fake provider.
- **Validation/publication:** owner-managed Ubuntu 24.04 AMD64 Docker builder on
  ubuntu-home, with persistent caches. Hosted GitHub Actions CI/release workflows
  are disabled; GitHub stores the source and explicitly published batch releases.

## 3. Repository layout and architecture

```text
pop-agent/
├── docs/specs/            # modular normative specification set
├── AGENTS.md              # agent entry point and repository quick facts
├── package.json           # workspaces: shared, server, web, cli
├── shared/src/            # pure DTO wire contract
├── server/src/
│   ├── domain/            # entities, value objects and pure policy
│   ├── application/       # use cases and application-owned ports
│   ├── infrastructure/    # SQLite, pi, filesystem and provider adapters
│   ├── interface/         # Hono routes, SSE and DTO mapping
│   ├── architecture/      # enforced dependency-boundary tests
│   └── main.ts            # composition root
├── web/                   # React PWA
├── cli/                   # terminal client and PLA runtime
├── launcher/              # native `pop` bootstrap/update launcher
├── local-access/          # native tray hosts and installer-only Windows wizard
└── tools/                 # generators, checks, packaging and smoke
```

The backend follows enforced clean architecture:

- `domain` imports no product layer;
- `application` depends inward on domain and owns ports;
- `infrastructure` implements ports and may depend on application/domain;
- `interface` owns transport validation and DTO mapping;
- `main.ts` is the composition root;
- `shared` contains dependency-free wire DTOs consumed by server, web and CLI;
- domain objects never cross the HTTP/SSE boundary;
- the architecture test enforces dependency direction and inner-layer purity.

Persistence ports isolate application policy from SQLite and make adapters
replaceable and testable. They do not imply a multi-user product roadmap.

The PWA has a simpler boundary: components render and compose behavior;
`web/src/services/` is the only door to HTTP, SSE and external browser
integration. The UI design-system check prevents pages from creating a second
control skin.

The generated self-map derives package versions, source-layer counts, PWA routes
and Settings sections from code. `npm run selfmap:check` prevents drift.

## 4. Runtime data and workspace

The default durable data root is `~/.pop-agent/`, owner-only and overrideable
with `POP_AGENT_DATA_DIR`.

```text
~/.pop-agent/
├── pop-agent.db           # SQLite product state
├── secret.key             # local encryption/signing key, mode 0600
├── sessions/              # pi-owned JSONL sessions
├── files/                 # the user's Files tree
├── notes/                 # private Markdown notes vault
├── skills/                # personal and automatic skill vaults
├── pi-runtime/            # validated isolated pi candidates and pointer
├── releases/              # durable immutable client release history
├── pi-agent/              # pi runtime support state
├── pi-auth.json           # pi-managed subscription credentials
├── models/                # local embedding model cache
└── voice-models/          # local transcription models
```

Some small update/provider state files also live under the data root. Their
adapters, not this overview, define exact volatile names.

The default working root is `~/pop-agent-workspace/`, overrideable with
`POP_AGENT_WORKSPACE`. It is intentionally separate from secrets and durable
product internals. It contains cloned projects and scratch work, plus:

```text
pop-agent-workspace/
├── Files -> ~/.pop-agent/files   # controlled symlink to the Files tab
└── attachments/<chatId>/         # tool-readable message attachment copies
```

Backups default to `pop-backups/` beside the data directory, never inside the
tree being archived. Backup policy and exact inclusion/exclusion rules live in
`Spec-Pop-Memory-and-Storage.md`.

Core environment settings:

- `POP_AGENT_PORT` (default `8787`);
- `POP_AGENT_BIND` (default `127.0.0.1`);
- `POP_AGENT_DATA_DIR`;
- `POP_AGENT_WORKSPACE`;
- `POP_AGENT_ENGINE` (`pi` or the test-only `fake`).

Provider secrets are not configuration-file defaults. The session signing
secret is encrypted in SQLite; `secret.key` is excluded from backups so copied
archives cannot decrypt SecretsRepo values or obtain the session-signing secret
from that store alone. Pi-managed sign-in tokens are stored separately in
unencrypted `pi-auth.json` and can be included in backups; see the Security spec.

## 19. Versioning and roadmap

- Root `VERSION` is the manually edited global product version and must agree
  with package manifests, lockfile workspace entries and protocol metadata.
- Pop Agent uses semantic versions and annotated release tags. Released bytes
  are immutable; changed bytes require a new version and URL.
- `CHANGELOG.md` records shipped changes. `History-Pop-Spec.md` preserves the
  detailed migrated decision history without making superseded behavior current.
- The product is pre-1.0 and may still make intentional compatibility changes,
  but protocol breaks must update explicit minimum-version gates and migration
  behavior.
- Roadmap ideas belong in research/proposal documents until approved. The
  normative General spec does not promise a fixed list of future features.

## 20. Working conventions

- Read the General index and relevant focused specs before architectural work;
  inspect current code and tests before asserting implementation details.
- Repository changes are English and limited to the requested concern.
- Batch GitHub pushes and prebuilt releases at owner-agreed publication points,
  rather than after each small change. A daily batch is an option, not an
  automatic schedule. Continue local implementation, validation and authorized
  principal-server updates between batches; do not bump the product version or
  dispatch a release for every individual adjustment.
- Parallel or isolated work uses Git worktrees. Never overwrite unrelated work
  found in `main`.
- During development: review the related diff, run checks appropriate to the
  change, commit only related files locally and verify final Git status. Before
  publishing a batch, the local release builder must pass the full exact-tree
  `npm run gate` once (or reuse its successful receipt for at most 24 hours).
  Do not repeat the full gate for each small adjustment or on hosted Actions.
- The gate runs version consistency, pi patch validation, specification and
  generated self-map checks, lint, typecheck, Go launcher/tray checks, build,
  the complete test suite and smoke.
- Runtime changes are not deployed merely because they compiled. Activate the
  committed checkout through the appropriate service/update path, then verify
  health, running commit/version and repository status.
- After a timeout, restart or resumed conversation, inspect the real repository,
  service and process state before claiming that a gate, commit or deployment
  completed.
- Device-only behavior—installed PWA lifecycle, passkeys, push with the app
  closed, microphone capture and platform-native tray/install behavior—receives
  an explicit device checklist after automated coverage.
- Small implementation choices may be made within approved scope; product,
  security or architectural changes require the owner's explicit decision and
  an update to the relevant normative specification.
- Historical plans and research remain useful evidence but do not override the
  current modular specification set.
