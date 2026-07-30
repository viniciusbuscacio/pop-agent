# AGENTS.md — Popy

**Read `popy.spec` before doing anything. It is the single source of truth.**

Quick facts for agents working in this repo:

- Popy is a self-hosted, single-user personal agent platform. Node 22 +
  TypeScript strict, pure ESM, monorepo (`shared/`, `server/`, `web/`).
  The engine is the pi agent (`@earendil-works/pi-coding-agent`) via SDK.
- Architecture law: the backend is 100% clean architecture —
  `domain / application / infrastructure / interface` + `main.ts` as the
  composition root, DTOs in `shared/` (the wire contract, consumed by web
  too). Domain objects never cross the interface boundary. The dependency
  rule and inner-layer purity are enforced by
  `server/src/architecture/boundary.test.ts` in the gate. The React app
  only paints; components never call `fetch` — only `web/src/services/*`.
- Gate before every commit: `npm run gate` (lint + typecheck + tests +
  build). Green gate → conventional commit straight to main. English
  everywhere in the repo.
- Test end-to-end without clicking: `tools/smoke.ts` (temp DB + fake
  provider) and the `GET /v1/ax` control plane.
- UI vetoes (permanent): no side drawer for forms; no emoji as icons;
  every Save has a Cancel.
- Zero telemetry. No unasked network calls anywhere (update check is
  opt-in, default OFF).

When a session produces a new rule or decision, update `popy.spec` (bump
its changelog) — not this file, unless the repo-specific quick facts above
change.
