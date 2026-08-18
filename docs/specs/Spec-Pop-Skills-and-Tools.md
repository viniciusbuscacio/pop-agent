# Pop Agent — skills and tools

**Status:** normative
**Legacy coverage:** §§8 and 12
**Primary implementation:** `server/src/domain/skills/`, `server/src/application/skills/`, `server/src/infrastructure/skills/`, `server/src/infrastructure/{web,mcp}/`
**Related:** [`Spec-Pop-Pi-Agent-Integration.md`](Spec-Pop-Pi-Agent-Integration.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md), [`../mcp.md`](../mcp.md)

## Purpose and authority

A skill is durable procedural context, not executable code or a permission. A
tool is an executable capability with a typed input contract. Skills may help
the model decide how to use tools, but they cannot grant a tool, bypass Plan
Mode, change server policy or override the active tool catalogue.

The server owns skill storage, routing, automatic learning and tool projection.
The PWA owns editing and observability. Pi receives only the selected context
and tools for the current session/turn.

## Skill sources and formats

Exactly three sources exist:

- `builtin`: shipped with Pop Agent and refreshed only while unmodified;
- `user`: created or edited by the owner;
- `auto`: published by the reviewed background pipeline.

The vault is `POP_AGENT_DATA_DIR/skills/` and accepts:

1. legacy flat `<slug>.md` files with Pop front matter;
2. recursively discovered Agent Skills directories containing `SKILL.md`.

A discovered skill directory is a boundary; nested asset directories are not
scanned as separate skills. Hidden folders and `_archive/` are excluded. Flat
files win a slug collision. Slugs are lowercase alphanumeric/dash identifiers,
and invalid or incomplete documents do not enter the active vault.

Editing an Auto-Skill promotes it to `user`. Built-ins may be edited or
disabled but not deleted or archived. User and auto skills may be deleted.
Archiving removes a skill from routing without destroying it and is reversible.

## Built-ins and self-knowledge

Pop Agent ships a small, code-owned built-in set. Seeding is content-hash aware:
an untouched seed follows product updates while a user-modified copy is
preserved. The generated repository/UI map is produced by the gate and must not
be hand-maintained.

Pinned skills enter the session instruction block once. They do not compete for
per-turn routing slots. The pinned set must remain tiny; broad procedural
knowledge belongs in routed skills. Changes to pinned skills, the vault or its
policy participate in pi session-context revisioning.

## Local Skill Router

Selection is local and spends no LLM call. It combines:

- IDF-weighted lexical overlap over name, description and `whenToUse`;
- optional semantic cosine ranking over persisted routing-text embeddings;
- reciprocal-rank fusion to order candidates admitted by either signal.

RRF orders candidates; it never creates eligibility. The router injects at most
the configured small top set and may correctly select nothing. Disabled and
pinned skills cannot take a routed slot.

The semantic gate is distribution-relative because embedding cosine values are
model-dependent and compressed. With at least five vectors, candidates require
the configured z-score and floor; a smaller vault uses the conservative
small-sample floor. Vector dimension mismatches are discarded. Editing routing
text invalidates only that skill's vector.

The embedding index covers the complete active vault, including entries that
cannot route. Auto-Skill deduplication consumes the same index, so selection
filters must never be applied before indexing. Every injected skill increments
its use count and last-used timestamp. Route logs contain slugs and lexical,
semantic and fused scores, never the user's message.

## Prompt placement

Pinned bodies are session instructions. Routed bodies are prompt-only context
for the applicable user/steering message. Neither is persisted into the owner's
original chat message. Pi native host skill discovery is disabled; otherwise it
would expose every description and defeat Pop's bounded router.

Skill text is context, not authority above product instructions. User-supplied
skill content remains owner-controlled data and still cannot alter the active
tool catalogue or deterministic guards.

## Owner-facing skill management

The authenticated Skills API/UI provides:

- active and archived skill snapshots;
- create/edit, enable/disable, delete and restore actions according to source;
- use counts and last-used time;
- Auto-Skill status and bounded distillation history;
- retry only for retryable failed/invalid immutable windows.

Saving validates field lengths and slug syntax. Automatic publication is not an
approval inbox: a skill is active only after all mandatory checks. Editing it is
ordinary owner control and promotes an auto source to user.

The agent receives only `skills_list`. It has no live `skill_write` tool and
must not narrate internal learning decisions. An explicit request for a skill
prioritizes that completed conversation for the same background pipeline; it
does not bypass review or safety.

## Auto-Skills policy

`autoSkillsEnabled` defaults to true. Disabling it stops new learning but does
not disable already published skills. Legacy multi-level values migrate to this
boolean.

One conversation is evaluated per scheduler tick. Explicit multilingual skill
requests skip idle waiting; ordinary conversations must first become idle. An
initial unread window below 500 raw characters advances as
`below_minimum_content` without a model call. Later concise additions remain
eligible. A tainted window or unresolved failed/interrupted implementation also
advances without a model call.

The fail-closed pipeline is:

```text
eligibility → taint check → isolated creator → parse/schema/English contract
→ deterministic policy → secret scrub → normalization → dedup
→ review envelope/hash → isolated reviewer → final validation
→ recoverable publication → immediate vector indexing
```

Creator output is marker-delimited Markdown, not JSON, and contains stable
source-message evidence IDs. At most five candidates are accepted. Candidates
must describe a complete, reusable procedure with a credible future trigger
for this owner; one-off fixes already landed in product code are not reusable by
default.

Automatic skill prose and metadata are English. Owner-uploaded skills may use
any language. Deterministic policy normalizes Unicode, removes zero-width text,
enforces schema/size limits, blocks instruction-override/future-agent patterns
and scrubs credentials. A deterministic veto cannot be rewritten or rescued by
a model.

## Deduplication, review and publication

Dedup requires both semantic similarity (currently cosine ≥ 0.88) and lexical
vocabulary overlap (currently ≥ 0.25), plus exact/rewording checks. The complete
vault and archive remain comparison material.

- a builtin/user match becomes `protected_duplicate` before reviewer spend;
- an auto match may become a revision;
- automatic revisions have a 30-day per-slug cooldown;
- precision takes priority over aggressive merging.

The review hash binds normalized sanitized content, action, target slug, target
version and nearest dedup neighbour. The reviewer receives the sanitized source
window and candidates as untrusted data, in a fresh completion. It must return
exactly one valid verdict per expected hash. Missing, extra, duplicate,
truncated, inconsistent or mismatched verdicts publish nothing.

Publication writes a same-volume temporary file, durably records a prepared
SQLite journal, keeps a durable prior version for revision, atomically renames,
updates vectors/history/watermark, commits and cleans up. Prepared slugs stay
invisible. Boot recovery rolls back prepared work and completes committed
cleanup. The archive cap is 1,000 active Auto-Skills; least-used overflow is
archived, never deleted.

The watermark advances for deterministic completed outcomes, including taint,
empty output, protected duplicate, rejection and successful publication.
Provider, parser/truncation, reviewer/hash, filesystem or transaction failures
remain retryable and do not silently skip the window. Creator and reviewer usage
is booked under distinct service purposes.

## Tool projection and execution modes

Pop-owned tools are built from application ports when a pi session opens.
Ordinary server `read`, `bash`, `edit` and `write` retain their server meaning;
PLA operations are explicitly prefixed `local_*`. Enabled MCP and selected
local tools participate in session-context revisioning.

Normal Mode restores the captured catalogue. Plan Mode starts with a reduced,
fail-closed catalogue: server read-only tools plus MCP tools explicitly marked
`readOnlyHint: true`. Missing MCP annotations mean denial. A prompt instruction
is never the only enforcement.

Every tool has a typed schema, bounded output where applicable, explicit error
mapping and cancellation through the run signal. Tool output is untrusted and
passes through the external-content envelope/taint path before it can influence
a later dangerous tool call.

## `web_fetch`

`web_fetch(url)` accepts only credential-free HTTP(S) URLs. It:

- resolves every address and rejects loopback, private, link-local, CGNAT,
  multicast, reserved and cloud-metadata ranges;
- pins the HTTP connection to the exact screened address set, preventing DNS
  rebinding between validation and connect;
- refuses redirects, because a new destination needs a new policy decision;
- applies a 20-second timeout and stops reading after 5 MiB;
- extracts bounded readable text and treats the result as untrusted data.

Interactive JavaScript pages may be researched through Playwright launched by
server bash when relevant. Browser artifacts requested by the owner belong in
`Files/`; browser processes must be closed. Neither path receives secrets.

## MCP

MCP is a native Pop product integration, not a host-installed pi extension.
Pop owns server configuration, encrypted credentials, authorization, persisted
capabilities and status, lifecycle policy, PWA/API observability and per-session
tool projection. Pi receives enabled MCP tools through its supported custom-tool
SDK boundary. Host extension discovery remains disabled, and a third-party pi
package must not create a parallel MCP configuration, credential or update
boundary.

MCP mechanics use the official TypeScript SDK behind `McpClientFactory`; Pop
must not hand-roll protocol framing. Stdio and Streamable HTTP negotiate modern
stateless discovery first and fall back to legacy initialization. Explicit
HTTP/SSE remains legacy-only. Negotiation verdicts are scoped by configuration
and authorization and expire; failures evict them.

A Pop-owned inline pi extension is appropriate only when a concrete integration
requires pi lifecycle events that custom tools cannot provide; extension-based
tool registration alone is not a reason to move MCP out of the product-owned
adapter. Adopting a third-party MCP extension requires a new normative decision
and proof that all Pop security, Plan Mode, cancellation, isolation,
observability and session-freshness contracts remain enforced.

The SDK owns pagination, sessions, required headers, request SSE, cancellation,
metadata and stdio cleanup. A stdio child receives only the SDK safe environment
plus that server's encrypted variables, never Pop Agent's full environment.
Tools, resources/templates and prompts are discovered and projected with stable
names. MCP outputs and errors are always external untrusted content. Detailed
wire behavior and compatibility cases live in `docs/mcp.md`. The non-normative
trade-off analysis is preserved in
[`Research-Pop-MCP-Pi-Integration-Strategy.md`](Research-Pop-MCP-Pi-Integration-Strategy.md).

## Failure and test obligations

- Missing embeddings degrade to lexical routing; they do not disable skills.
- Invalid skill files are skipped without escaping the vault.
- Creator/reviewer/provider failure cannot publish partial work.
- A crash during publication is reconciled on boot.
- MCP failure is isolated to that server/call.
- Web retrieval never falls back to an unchecked address or redirect.

Focused tests cover vault formats/collisions/jails, built-in upgrade behavior,
routing thresholds/indexing/usage, every Auto-Skill gate and recovery phase,
web SSRF/address pinning/limits, MCP negotiation and tool mapping. The full gate
must pass before these contracts ship.
