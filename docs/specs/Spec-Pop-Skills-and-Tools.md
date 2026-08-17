# Pop Agent — Skills and agent tools

**Status:** current architecture explanation
**Normative source:** `pop-agent.spec` §§5, 8, 10–12
**Primary code:** `server/src/domain/skills`, `server/src/application/skills`, `server/src/infrastructure/skills`, agent tool adapters

## Skills

Skills are instructions selected for a turn, not executable plugins. Three sources exist:

- `builtin`: shipped with Pop Agent;
- `user`: controlled by the owner;
- `auto`: published by the reviewed background learning pipeline.

Built-ins are seeded from repository definitions. Personal and auto skills live in the data directory. Flat Markdown and Agent Skills directory format coexist according to the normative scanner rules.

## Routing

The local router combines lexical and multilingual semantic rankings, admits candidates only when a signal clears its gate, and injects a small top set. Routing is local and does not spend a model call. Pinned skills are placed in session instructions instead of competing for turn slots.

The router indexes the full relevant vault for deduplication even when a skill is excluded from current selection.

## Auto-skills

The background pipeline is fail-closed: eligibility, taint, isolated creation, deterministic policy, secret scrub, normalization, dedup, bound independent review, validation and recoverable publication. Chat agents do not write or announce skills directly. Existing automatic learning is controlled by Settings.

## Built-in self-knowledge

`pop-agent-manual` is pinned identity and operational knowledge. `pop-agent-codebase` routes architecture/code questions. It points to `docs/specs/Spec-Pop-General.md`, which routes the agent to focused internal specifications. Detailed documents are read on demand rather than injected into every turn.

## Tool families

- server filesystem/process: `read`, `bash`, `edit`, `write`;
- Files: search and trash-safe deletion;
- Notes vault;
- conversation memory and living user memory;
- public web fetch;
- MCP tools;
- selected-computer `local_*` tools;
- product-specific read/update tools exposed through pi custom tools.

Each tool is registered through a typed schema and adapter. External tool results remain untrusted content.

## Plan Mode

Plan Mode computes a fail-closed read-only active-tool set per message. Write, shell, delete, unknown and unannotated MCP tools are absent. Enforcement occurs in the runtime tool catalogue, not only in prose.

## Safety

Tool power and content trust are separate questions. A tool may be allowed but blocked or confirmed because tainted external content influenced the turn. Secrets are never persisted to skills, notes or memory. Local and server paths retain distinct provenance.

## Adding or changing a skill

Update routing text, multilingual regression cases, seeding behavior, content hash and relevant docs. Keep built-in bodies short. New internal architecture knowledge belongs in focused specs when it is too large for the skill prompt.

## Adding or changing a tool

Define the application boundary, typed input/output, trust envelope, Plan Mode classification, path and size limits, cancellation, logging policy and tests. Update shared DTOs only if the tool crosses the product wire.
