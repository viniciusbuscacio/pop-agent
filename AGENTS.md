# AGENTS.md — Pop Agent

**Read `docs/specs/Spec-Pop-General.md` before doing anything. It is the entry point to the normative modular specification set.**

Quick facts for agents working in this repo:

- Pop Agent is a self-hosted, single-user personal agent platform. Node 22 +
  TypeScript strict, pure ESM, monorepo (`shared/`, `server/`, `web/`, `cli/`).
  The engine is the pi agent (`@earendil-works/pi-coding-agent`) via SDK.
- Backend architecture: `domain / application / infrastructure / interface`,
  with `main.ts` as the composition root and wire DTOs in `shared/`.
  Application-owned ports isolate database, provider and protocol adapters.
  Interface code validates requests and maps domain/application results to DTOs;
  domain entities must not be serialized directly as API responses.
- Keep dependencies pointing inward. Domain/application/shared have no
  third-party production imports. `server/src/architecture/boundary.test.ts`
  checks static import boundaries and permits Node built-ins; passing it does
  not prove I/O isolation or DTO mapping. Known filesystem I/O debt remains in
  `domain/files/safe-path.ts`, `application/files/files-service.ts` and
  `application/mcp/mcp-service.ts`. Do not expand these shortcuts; new I/O
  belongs behind application ports and infrastructure adapters. See
  `docs/specs/Spec-Pop-Backend.md` for the required architecture.
- Frontend network access belongs in `web/src/services/*`, not components.
  Follow the shared UI primitives and theme tokens described in
  `docs/specs/Spec-Pop-Style-Guide.md`.
- During development, run checks appropriate to the change and commit locally.
  Batch GitHub pushes and releases only at owner-agreed publication points.
  The local Ubuntu 24.04 release builder runs/reuses the full exact-tree gate
  once per batch; do not repeat it on GitHub Actions. English everywhere.
- Test end-to-end without clicking: `tools/smoke.ts` (temp DB + fake
  provider). Owner sessions use `GET /v1/ax`; integrations use
  `GET /v1/integration/ax` with their independently authorized REST API key.
- UI vetoes (permanent): no side drawer for forms; no emoji as icons;
  every Save has a Cancel.
- Zero telemetry. Network traffic must serve owner-invoked or configured
  features, including model calls, enabled background work and integrations.
  Follow the update policy in `docs/specs/Spec-Pop-Installation.md`.

When a session produces a new rule or decision, update the relevant normative
file under `docs/specs/` and `CHANGELOG.md` when the product changed — not this
file, unless the repository-specific quick facts above change.
