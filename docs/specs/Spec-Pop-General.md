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
| §6 — database | [Spec-Pop-Backend.md](Spec-Pop-Backend.md) |
| §7 — memory | [Spec-Pop-Memory-and-Storage.md](Spec-Pop-Memory-and-Storage.md) |
| §8 — skills | [Spec-Pop-Skills-and-Tools.md](Spec-Pop-Skills-and-Tools.md) |
| §§9–10 — auth, secrets and external-content safety | [Spec-Pop-Security.md](Spec-Pop-Security.md) |
| §11 — Notes | [Spec-Pop-Memory-and-Storage.md](Spec-Pop-Memory-and-Storage.md) |
| §12 — web and MCP access | [Spec-Pop-Skills-and-Tools.md](Spec-Pop-Skills-and-Tools.md) |
| §13 — API contract | [Spec-Pop-API.md](Spec-Pop-API.md) |
| §14 — PWA/frontend | [Spec-Pop-Frontend.md](Spec-Pop-Frontend.md) |
| §15 — providers and models | [Spec-Pop-Providers-and-Models.md](Spec-Pop-Providers-and-Models.md) |
| §15 updates — server, pi, CLI and PWA update channels | [Spec-Pop-Installation.md](Spec-Pop-Installation.md) |
| §16 — backup and restore | [Spec-Pop-Memory-and-Storage.md](Spec-Pop-Memory-and-Storage.md) |
| §17 — CLI and operator CLI | [Spec-Pop-CLI.md](Spec-Pop-CLI.md) |
| §17.1 — installed PWA and optional local access | [Spec-Pop-Local-Access.md](Spec-Pop-Local-Access.md) |
| §18 — production exposure | [Spec-Pop-Deployment-and-Operations.md](Spec-Pop-Deployment-and-Operations.md) |
| §§19–20 — roadmap and working conventions | this document |
| §21 — background tasks and maintenance | [Spec-Pop-Background-Tasks.md](Spec-Pop-Background-Tasks.md) |
| SSE and snapshot synchronization | [Spec-Pop-Events-Synchronization.md](Spec-Pop-Events-Synchronization.md) |
| UI design system | [Spec-Pop-Style-Guide.md](Spec-Pop-Style-Guide.md) |
| Detailed historical decisions | [History-Pop-Spec.md](History-Pop-Spec.md) and Git history |

## Authority and maintenance

- A new cross-cutting normative decision updates this document.
- A subsystem decision updates its focused normative specification.
- A new focused specification is added to the index above.
- Volatile implementation detail should be derived from code where practical.
- Research drafts, Obsidian notes and Files documents are not normative until
  their accepted decisions are incorporated into this set.
- Historical entries are preserved as history, not left mixed into current rules.

## High-value paths by task

- HTTP contract: `shared/src`, application use case/port, `server/src/interface/http`, `web/src/services`.
- Chat run: `server/src/application/chat`, `server/src/infrastructure/agent`, `docs/agent-flow.md`.
- Screen: `web/src/routes`, `web/src/services`, `web/src/store`, `web/src/ui`.
- Persistent setting: application service/port, settings adapter, DTO, route and UI service.
- Agent tool: application policy, infrastructure registration, safety classification and Plan Mode tests.
- Installation/update: launcher/scripts, immutable artifacts, installation UI and platform tests.

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

- **Backend**: Node.js 22 LTS, TypeScript strict, pure ESM. HTTP: Hono.
  Validation: Zod at the borders. Logs: pino (JSON in prod, pretty in dev;
  never log message content in prod).
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
├── docs/specs/            # this modular normative specification set
├── AGENTS.md              # agent entry point and repository quick facts
├── package.json           # workspaces: shared, server, web, cli
├── shared/src/            # pure DTO wire contract
├── server/src/
│   ├── domain/            # entities, value objects and pure policy
│   ├── application/       # use cases and ports
│   ├── infrastructure/    # SQLite, pi, filesystems and provider adapters
│   ├── interface/         # Hono routes, SSE and DTO mapping
│   ├── architecture/      # enforced dependency-boundary tests
│   └── main.ts            # composition root
├── web/                   # React PWA
├── cli/                   # terminal client and PLA runtime
├── launcher/              # native `pop` bootstrap/update launcher
├── local-access/          # minimal native tray hosts
└── tools/                 # generators, checks, packaging and smoke
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
