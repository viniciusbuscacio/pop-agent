# Pop Agent — Security and trust boundaries

**Status:** current architecture explanation
**Normative source:** `pop-agent.spec` §§1, 9, 10, 12, 16 and 18
**Primary code:** `server/src/application/auth`, `server/src/domain/safety`, auth/crypto/web adapters
**Related:** [`../injection-tests.md`](../injection-tests.md)

## Security model

Pop Agent is powerful software intentionally controlled by one owner. It is not a sandbox. Security therefore combines authenticated single-user access, secret protection, deterministic boundaries, content trust tracking, path safety and explicit local-computer permission.

## Authentication

The product uses password-only login, recovery material and session tokens according to `pop-agent.spec`. Password hashing, lockout and session epoch rules are server-owned. Passkeys may unlock an existing owner identity; they do not create users.

SSE exchanges an authenticated session for a short-lived one-use ticket because EventSource cannot send an authorization header.

## Secrets

Provider credentials and session secrets are encrypted at rest using the installation key. Secret values are write-only over product APIs, excluded from backups where specified and never logged. Pasted credentials may be used for the requested task but must not enter notes, memory or skills.

## External content and taint

Web pages, fetched documents, MCP results, file contents and retrieved historical material are untrusted data. Sanitization and taint propagation prevent text inside data from becoming higher-priority instructions. Sensitive/destructive tool use in a tainted turn follows deterministic policy and confirmation rules.

See `docs/injection-tests.md` for adversarial coverage.

## Tool authorization

Available tools are computed by the runtime. Plan Mode removes non-read tools fail-closed. MCP read-only eligibility depends on exact standard annotations. Local tools require a selected live machine plus enabled server-side policy.

A prompt or documentation file never grants authorization.

## Filesystem and process boundaries

All user-controlled paths pass through jail/normalization checks. Archives reject traversal and special entries. Commands are executed with explicit arguments where the product constructs them; credentials do not travel in argv or environment. Stop/cancel must terminate owned process work.

## Network

`web_fetch` blocks private/loopback targets and treats responses as untrusted. Public installers contain no account token. Production exposure uses HTTPS. Zero telemetry means no unasked outbound product analytics or phone-home.

## Local access

PLA gives the agent the local user's privileges and must be visibly installed and independently disableable. A transport connection is not enough: stable machine selection and persisted permission are checked for each call. Never silently reroute an unavailable local operation.

## Logging and audit

Production logs avoid message/tool content, tokens and secret values. Durable product actions are represented in the appropriate chat, journal or database record. SSE itself is not an audit log.

## Change checklist

Threat-model authentication, authorization, taint, secret exposure, path traversal, SSRF, replay, downgrade, cancellation and logs. Add negative tests. Run the safety scan and full gate before commit. Security-sensitive protocol changes require explicit review of both ends.
