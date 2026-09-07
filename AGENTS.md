# AGENTS.md — Pop Agent

**Read `docs/specs/Spec-Pop-General.md` before doing anything. It is the entry point to the normative modular specification set.**

Quick facts for agents working in this repo:

- Pop Agent is a self-hosted, single-user personal agent platform. Node 22 +
  TypeScript strict, pure ESM, monorepo (`shared/`, `server/`, `web/`, `cli/`).
  The engine is the pi agent (`@earendil-works/pi-coding-agent`) via SDK.
- Architecture law: the backend is 100% clean architecture —
  `domain / application / infrastructure / interface` + `main.ts` as the
  composition root, DTOs in `shared/` (the wire contract, consumed by web
  too). Domain objects never cross the interface boundary. The dependency
  rule and inner-layer purity are enforced by
  `server/src/architecture/boundary.test.ts` in the gate. The React app
  only paints; components never call `fetch` — only `web/src/services/*`.
- During development, run checks appropriate to the change and commit locally.
  Batch GitHub pushes and releases only at owner-agreed publication points.
  The local Ubuntu 24.04 release builder runs/reuses the full exact-tree gate
  once per batch; do not repeat it on GitHub Actions. English everywhere.
- Test end-to-end without clicking: `tools/smoke.ts` (temp DB + fake
  provider) and the `GET /v1/ax` control plane.
- UI vetoes (permanent): no side drawer for forms; no emoji as icons;
  every Save has a Cancel.
- Zero telemetry. No unasked network calls anywhere (update check is
  opt-in, default OFF).

When a session produces a new rule or decision, update the relevant normative
file under `docs/specs/` and `CHANGELOG.md` when the product changed — not this
file, unless the repository-specific quick facts above change.
