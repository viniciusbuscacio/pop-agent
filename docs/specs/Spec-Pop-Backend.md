# Pop Agent — Backend architecture

**Status:** current architecture explanation
**Normative source:** `pop-agent.spec` §§2–13, 15–21
**Primary code:** `server/src`, `shared/src`

## Shape

The backend is a strict TypeScript clean architecture application served by Hono. Dependencies point inward:

```text
domain ← application ← infrastructure
          ↑              ↑
          └──── interface┘
                 ↑
              main.ts
```

`server/src/architecture/boundary.test.ts` enforces allowed imports and inner-layer purity. `main.ts` is the composition root and the only place that knows concrete adapters together.

## Layers

### Domain

Pure entities, value objects, IDs, errors and deterministic policy. It does not know HTTP, SQLite, pi or React.

### Application

Use cases and ports. The application owns abstractions such as repositories, agent execution, clock, event delivery and external capabilities. It may depend on domain, not infrastructure.

### Infrastructure

Adapters for SQLite, pi, filesystems, providers, embeddings, backups, voice, MCP and other IO. Infrastructure implements application ports.

### Interface

Hono routes, authentication middleware, request validation, DTO mapping, SSE and protocol edges. Domain objects do not leave this boundary.

### Shared

Plain DTOs used by server, PWA and CLI. Shared is the wire contract and has no product adapter dependencies.

## HTTP design

Authenticated product routes live under `/v1`. Inputs are validated at the interface border. Route handlers map requests to application commands and results back to DTOs. Public bootstrap or immutable artifact routes are narrowly scoped and must not expose private state.

Components never invent a second wire shape. Change `shared` deliberately and update every producer and consumer in the same change.

## Persistence

SQLite uses numbered boot migrations, WAL and repository adapters. Synchronous `better-sqlite3` operations are acceptable for the single-user scale. Filesystem stores remain behind path-safe services and ports.

Transaction boundaries belong around business operations that must be atomic; do not spread SQL concerns into use cases.

## Runtime services

Long-lived services include run orchestration, the SSE hub, scheduler, local-connection registry, skill router and update/status services. They are wired once in `main.ts`, receive explicit dependencies and expose testable application contracts.

## Concurrency

The run service owns chat exclusivity, global capacity, durable follow-ups and steering. Background tasks are serialized independently. SQLite ordering and atomic updates must remain deterministic under multiple tabs and chats.

## Errors

Expected failures become stable API error codes and appropriate HTTP statuses. Do not leak stack traces, provider secrets or private paths. Infrastructure exceptions are translated at an owned boundary rather than silently swallowed.

## Tests

- domain/application unit tests cover policy without IO;
- adapter tests use temporary stores or protocol fixtures;
- route tests exercise validation and auth;
- architecture tests enforce imports;
- smoke tests cross the real HTTP/SSE product path with a fake provider.

## Change checklist

Trace any backend change through:

1. normative rule;
2. domain/application contract;
3. port and adapter;
4. shared DTO where it crosses the wire;
5. route and auth;
6. client consumer;
7. migrations and rollback implications;
8. unit, contract and smoke coverage.
