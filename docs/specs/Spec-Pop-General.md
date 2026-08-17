# Pop Agent — General architecture and specification index

**Status:** current architecture overview
**Normative source:** [`../../pop-agent.spec`](../../pop-agent.spec)
**Implementation source:** current code and tests
**Audience:** Pop Agent itself and maintainers

## Purpose

This is the entry point for Pop Agent's internal specifications. It is a map, not a second normative specification. Read only the focused documents relevant to the task, then inspect code and tests before changing behavior.

## Authority

1. Code and tests describe what is implemented.
2. `pop-agent.spec` defines current product and architecture rules.
3. These focused specs explain subsystems and point to their code.
4. Obsidian notes and Files documents are research/history unless accepted into the repository.

When sources disagree, report the divergence. Do not silently treat an old explanation as current behavior.

## Product overview

Pop Agent is a self-hosted, permanently single-user personal agent. A Node/TypeScript server embeds pi through its SDK, persists product state in SQLite, and serves a React PWA over the same HTTP origin. A terminal client and optional Pop Local Access can attach a user's computer while the agent brain, providers, sessions, memory and safety policy remain on the server.

```text
Browser / installed PWA ── HTTP + SSE ──┐
Pop CLI ──────────────── HTTP + SSE ────┼── Pop Agent server ── providers
PLA tray / CLI ─────── WS or polling ───┘         │
                                                   ├── SQLite
                                                   ├── pi JSONL sessions
                                                   ├── Files
                                                   ├── Notes
                                                   └── Skills
```

## Repository map

- `shared/`: pure DTOs and cross-client wire contracts.
- `server/src/domain/`: entities, value objects and pure domain services.
- `server/src/application/`: use cases and ports owned by the application.
- `server/src/infrastructure/`: SQLite, pi, provider, filesystem and other adapters.
- `server/src/interface/`: Hono HTTP routes, SSE and transport mapping.
- `server/src/main.ts`: composition root.
- `web/`: React PWA.
- `cli/`: terminal client and local-access runtime.
- `launcher/`: native `pop` bootstrap/update launcher.
- `local-access/`: minimal native tray hosts.
- `tools/`: repository checks, generators, packaging and smoke tests.

The gate enforces backend dependency direction and inner-layer purity.

## Which specification to read

| Question | Focused specification | Existing deep dive |
|---|---|---|
| pi, sessions, models, tool execution | [Spec-Pop-Pi-Agent-Integration.md](Spec-Pop-Pi-Agent-Integration.md) | [`../agent-flow.md`](../agent-flow.md) |
| Clean architecture, API, persistence adapters | [Spec-Pop-Backend.md](Spec-Pop-Backend.md) | `pop-agent.spec` §§3–13 |
| PWA routes, state, services and rendering | [Spec-Pop-Frontend.md](Spec-Pop-Frontend.md) | `pop-agent.spec` §14 |
| SSE, tickets, invalidation and reconnection | [Spec-Pop-Events-Synchronization.md](Spec-Pop-Events-Synchronization.md) | [`../agent-flow.md`](../agent-flow.md) |
| PWA, CLI and PLA installation/update | [Spec-Pop-Installation.md](Spec-Pop-Installation.md) | [`../cli.md`](../cli.md) |
| Tray/CLI access to the user's computer | [Spec-Pop-Local-Access.md](Spec-Pop-Local-Access.md) | [`../cli.md`](../cli.md) |
| Built-in, personal and auto skills; agent tools | [Spec-Pop-Skills-and-Tools.md](Spec-Pop-Skills-and-Tools.md) | `pop-agent.spec` §§8, 10–12 |
| SQLite, Files, Notes, memory and backup | [Spec-Pop-Memory-and-Storage.md](Spec-Pop-Memory-and-Storage.md) | `pop-agent.spec` §§4, 6, 7, 11, 16 |
| Authentication, secrets, taint and trust | [Spec-Pop-Security.md](Spec-Pop-Security.md) | [`../injection-tests.md`](../injection-tests.md) |
| UI tokens, controls and visual invariants | [Spec-Pop-Style-Guide.md](Spec-Pop-Style-Guide.md) | [`../ui-style-guide.md`](../ui-style-guide.md) |

## High-value paths by task

- Add or change an HTTP contract: `shared/src`, application use case/port, `server/src/interface/http`, `web/src/services`.
- Change a chat run: `server/src/application/chat`, `server/src/infrastructure/agent`, `docs/agent-flow.md`.
- Change a screen: `web/src/routes`, `web/src/services`, `web/src/store`, `web/src/ui`.
- Add a persistent setting: application port/service, SQLite/settings adapter, DTO, route and UI service.
- Change an agent tool: application port/policy, infrastructure tool registration, safety classification and plan-mode tests.
- Change installation: launcher or scripts, immutable manifests/artifacts, Settings installation UI and platform tests.

## Working rule

Documentation narrows the search; it never removes the need to inspect the implementation. For architectural changes, read the relevant `pop-agent.spec` sections first. Before declaring code work complete, review the diff, run `npm run gate`, commit only related files and verify Git status.
