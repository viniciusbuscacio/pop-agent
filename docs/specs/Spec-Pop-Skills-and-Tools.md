# Pop Agent — skills, web and MCP tools

**Status:** normative
**Legacy coverage:** §§8 and 12
**Primary implementation:** server/src/domain/skills, server/src/application/skills, tool adapters
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
## 8. Skills with local mini-RAG selection ⭐ (the **Skill Router**)

Pop Agent ships a small roster of built-in skills (1.74: seven — the manual,
the codebase self-map, web research, note-taking, shell safety, the daily
review and code work) but injects only the relevant ones per user message —
selection is 100% local, no LLM call:

- Skill format: two coexisting shapes in `POP_AGENT_DATA_DIR/skills/` —
  (a) the original flat `<slug>.md` with `name` + `description` +
  `whenToUse` frontmatter (built-ins seeded from the repo keep this), and
  (b) the **Agent Skills standard** (agentskills.io): a directory holding
  a `SKILL.md`, discovered recursively (a skill directory's inner folders
  are assets, not skills). Slug = directory name; `whenToUse` falls back
  to `description`. Flat wins on a slug collision. Decided 01/08: the
  ecosystem converged on the standard and **pi implements it natively**,
  so Pop Agent adopts it in her own scanner rather than patching/translating
  pi (a patch would break on every pi update). New self-authored skills
  prefer the folder shape; both shapes route identically.
### Auto-Skills: reviewed background learning (12/08/2026)

- **Exactly three sources:** `builtin` (ships with the app), `user` (Personal,
  controlled by the owner), and `auto` (published by this pipeline). Editing an
  Auto-Skill promotes it to `user`. Automatic work may revise only `auto`; a
  Built-in or Personal match is a `protected_duplicate` and stops locally.
- **One setting:** `autoSkillsEnabled: boolean`, factory default `true`. The old
  `disabled | medium | full` values migrate as disabled → false and either enabled
  mode → true. Disabled stops new learning but does not disable existing skills.
  There is no pending state, approval endpoint, approval filter or revision inbox.
- **Invisible background process.** The chat agent cannot write skills or narrate
  internal decisions. An explicit multilingual request only prioritises that chat and
  skips the idle wait; it never bypasses a safety gate.
- **Canonical fail-closed pipeline:**

  `eligibility → taint → creator → parse/schema/English contract → policy gate →
  secret scrub → normalization → dedup → review envelope + review_hash → reviewer →
  final validation → recoverable publication + immediate indexing`.

  On its first evaluation, a conversation whose raw message-content total is below 500
  characters advances its watermark as `below_minimum_content` without either LLM call;
  later short increments remain eligible so concise corrections are not lost. A tainted window
  likewise advances without an LLM call. A conversation whose last implementation run failed
  or was interrupted without a later completed answer is also ineligible before either LLM:
  a plan, analysis, authorization or attempted implementation is not evidence of a procedure
  that worked. The creator and reviewer are fresh, isolated
  service completions with fixed English prompts. Creator output is
  marker-delimited Markdown (never JSON), includes stable evidence message ids, and may
  contain up to five candidates. Both stages require a plausible future need for this user
  after the current conversation and fix are complete; theoretical reuse by somebody is
  insufficient, and one-off product fixes already incorporated into code are rejected with
  `unlikely_future_reuse` unless a credible recurring workflow or independent trigger remains.
  The reviewer receives the sanitized original window and only surviving candidates as
  untrusted data; it returns exactly one APPROVE/REJECT block per `review_hash`. Approval
  requires `evidence_confirmed,reusable,complete`; rejection requires a controlled rejection
  reason. Missing, inconsistent, duplicate, unknown, truncated or mismatched verdicts publish
  nothing and do not advance the watermark.
- **Deterministic policy veto:** normalize NFKC, remove zero-width characters, collapse
  whitespace and block versioned classic injection/identity-override/future-agent patterns.
  A match is never rewritten or rescued. False positives are accepted unless real use shows
  systematic blocking that makes the feature inoperable; no minimum publication rate exists.
  Secret scrubbing, schema/size limits, source protection and final revalidation are likewise
  mandatory outside model judgment.
- **Dedup remains measured:** cosine ≥ 0.88 AND vocabulary overlap ≥ 0.25. The full vault,
  including archived skills, remains comparison material. A match against `auto` proposes
  `revision`; a match against `builtin`/`user` ends as `protected_duplicate` without
  spending the reviewer call. Exact duplicates and likely rewordings (high body-vocabulary
  overlap without substantial expansion) also terminate locally before review. A published
  automatic revision starts a 30-day per-slug cooldown before another may be reviewed.
  Precision beats aggressive merging or revision churn.
- **Review binding:** the SHA-256 `review_hash` covers normalized sanitized content, action
  (`new`/`revision`), target slug, target-version hash and nearest dedup neighbour. An
  approval for creation cannot authorize a revision, and a target changed after review fails.
- **Recoverable publication:** the vault writes a same-volume temporary file, fsyncs a durable
  backup for a revision, persists a SQLite `prepared` journal row, atomically renames, updates
  vectors/history/watermark, then commits and cleans up. Prepared slugs stay invisible to the
  router. Boot reconciliation rolls back prepared work or finishes committed cleanup. The
  previous revision remains as one-level rollback history.
- **Watermark:** advances on taint, valid empty output, deterministic/reviewer rejection,
  protected duplicate and successful publication. Provider, parser, reviewer/hash, write or
  transaction failure does not advance and is retryable. One conversation per scheduler tick
  remains the cost ceiling; creator/reviewer service runs are booked with distinct purposes.
- **Retention and visibility:** at most 1000 active Auto-Skills; least-used overflow is archived,
  never deleted. Archived entries leave routing but remain recoverable and deduplicable. Learning
  activity stays internal rather than appearing in the Skills navigation; failures that require
  user action should surface as specific, actionable notices. Existing router selection remains
  local and injects only its small top-N, so vault size does not equal prompt size.

- **Skill language**: skills the agent writes for itself are English —
  name, slug, frontmatter, body — same rule as the repo. Skills the end
  user uploads may be in any language; the router's semantic leg is
  multilingual and the lexical leg leans on translation-stable tokens.
- pi's native behavior (progressive disclosure: ALL descriptions in the
  system prompt) does not scale to dozens of skills and models often skip
  reading them. Pop Agent's selector replaces it.
- **Selector (built; 1.60 describes what exists).** Two rankings, fused
  with the same `fuseRankings` (RRF) the memory search uses — one function,
  not a second mechanism:
  - **lexical**: IDF-weighted token overlap between the message and each
    skill's name/description/`whenToUse`, computed in JS over the vault.
    Not FTS5: skills are markdown files in a folder, not rows, so there is
    no index to query.
  - **semantic**: cosine over `skill_embeddings`, one vector per skill.
  A skill enters a ranking only by clearing that ranking's bar. **RRF orders
  candidates; it does not create them** — that is what keeps an unrelated
  message selecting nothing at all. Either signal alone qualifies a skill;
  one both agree on outranks one only a single ranking found.
- **The semantic bar is relative, not absolute** (measured 07/08 against
  the real 24-skill vault). Over 192 query/skill pairs e5 cosines ran
  0.70–0.84 with p90 at 0.80, and the right skill for "the square root of
  1444" scored *below* that noise — there is no absolute line to draw. The
  gate is therefore a z-score over the spread of that one request:
  `z ≥ 2.1`, with 0.75 kept as a floor beneath it. On ten labelled requests
  that admitted five of eight real matches and neither of the two noise
  hits. Precision first: the lexical ranking is there to catch the rest, and
  a wrong skill costs one of three slots on every turn.
  **Too few measured skills for a z (< 5) does not mean the bare floor**
  (1.72): 0.75 sits inside the noise band, so a small vault would admit its
  luckiest member. The small sample gets the band's own p90 instead —
  `max(floor, 0.80)`.
- **Vectors are persisted** (`skill_embeddings`, migration 028). Keyed by
  slug and stamped with the routing text they came from, so editing a skill
  invalidates its vector and nothing else. A vector whose length disagrees
  with the current embedder is dropped rather than compared. Cold start
  16.3s, warm 2.0s on the real install.
- **The index covers the vault; the filter is on the selection** (1.65,
  found in production). `skill_embeddings` answers two questions, not one:
  which skills may take a slot this turn, and what the distiller's dedup
  compares a candidate against. Routing excludes pinned and disabled skills;
  **indexing excludes nothing.** Historically the router filtered before it
  indexed, so a then-pending skill never got a vector, and the distiller — whose
  whole dedup leg reads this table — compared every candidate against a set its
  own recent work was missing from. A background task opening a fresh chat every
  hour turned that into nine copies of one procedure. The reviewed pipeline has
  no pending state, but the full-vault indexing invariant remains.
- **The distiller stores the vector of the skill it writes** (1.65), rather
  than leaving it for the next user message: `candidateRoutingText` and the
  router's `routingText` are the same string, so the vector the dedup just
  computed is exactly the one the router would compute. Nothing else would
  store it in time — the router indexes when a message arrives, and the
  distiller runs on a timer. A tick every ten minutes cannot dedup against
  work that only gets indexed when somebody happens to chat. It is stored
  even when the table was empty and nothing was compared: returning early on
  an empty table is why the first skill of a fresh install was never indexed
  and the second could not be measured against it.
- **`use_count` / `last_used_at`** (`skill_usage`, migration 029): the
  router records every skill it injects. A counter and a stamp, not a
  boolean — a skill used twice a year must be distinguishable from one used
  never, which is what a fixed "90 days idle" rule cannot do. This is the
  evidence the archiving collector reads when the 1000-Auto-Skill safety cap
  is exceeded.
- Verify while coding: whether the SDK can scope which skills pi exposes
  per session/turn; if not, Pop Agent injects the selected skills as its own
  context and disables pi's native listing.

**Self-knowledge hardening** (designed in 1.25–1.26, built in 1.27):

- **Pinned skills.** A skill can be marked `pinned`. Pinned skills bypass
  the router and enter the **session system prompt once** (provider-cache
  friendly) — never the per-turn prepend, which would repeat them through
  the history. Identity is a prerequisite of every answer, not a
  situational skill: `know-thyself` ships pinned. The pinned set stays
  tiny and short (guideline: ≤2 skills, each about the size of today's
  know-thyself) — a fat pinned set recreates the scaling problem the
  router exists to solve.
- **Router observability.** The skill-router service logs, per turn, which
  skills were selected and with what scores. It logs **both components**,
  not just the fused one — `slug(rrf=0.0323 lex=3.22 cos=0.775)` — because
  the bars live on the component scales and a log of RRF alone could not
  tune either. Thresholds are tuned from these distributions, never
  guessed: e5-family embeddings compress cosine into a narrow band
  (unrelated pairs often score 0.70–0.80), so intuitions like "0.75 is too
  strict" do not transfer.
- **PT/EN routing gap — and what it actually costs.** User messages arrive
  in Portuguese; skill descriptions are English (repo language rule).
  Measured 07/08 on ten labelled requests: the lexical half alone found
  **two**, and both were requests whose right answer was "nothing" — its
  single real hit was `web-browsing` on "procura na internet", and only
  because "internet" is spelled the same in both languages. The fused
  router found seven. **No better lexical engine would change that** —
  FTS5, bm25, a real stemmer all rank word matches, and across languages
  there are no word matches to rank. The semantic leg is what carries
  recall here, which is the standing answer to "why not just match words?".
  `whenToUse` texts must still carry translation-stable trigger tokens
  ("typescript", "stack", "skill", "architecture"…), and a trigger that has
  to fire on an exact sentence carries that sentence in several languages
  (see `skill-creator`). Real PT dialogues that misrouted become test cases.
- **`self-architecture` skill** (routed, not pinned): the deep self-map —
  clean-architecture layers and the dependency rule, the monorepo layout,
  where Pop Agent's own source lives on the server (Pop Agent has bash; it can read
  its own code once it knows the path), and the decision rule: **Pop Agent's
  extensions are TypeScript on Pop Agent's own runtime**. The repo-map section
  is **generated from the code by a script** (runs with the gate), never
  hand-written — the spec stays the normative source; the map is derived.
- **UI map (navigation self-knowledge).** The agent runs server-side: it
  has no browser, no DOM, no accessibility (AX) tree of the PWA it fronts
  — a live AX tree exists only in the user's browser, out of reach by
  design. The equivalent knowledge is static and derivable: router paths
  in `web/src/App.tsx` and every visible label in `web/src/i18n/en.ts`
  are the source of truth for screens, menus and Settings sections. The
  self-map generator therefore also emits a **UI map** — routes, Settings
  sections, what each does — so Pop Agent directs the user through its own
  interface ("Settings → Model") instead of guessing. Same rule as the
  repo map: generated, never hand-written.

## 12. Web access (`infrastructure/web/`)

- v0.1: `web_fetch(url)` — fetch + Readability extraction + safety envelope
  (§10). pi has NO native web tools (confirmed) — this is a Pop Agent custom
  tool.
- Later: `web_search` (engine TBD) and Playwright for dynamic pages.

### MCP clients (`infrastructure/mcp/`)

MCP protocol mechanics belong to the official TypeScript SDK v2, behind the
application-owned `McpClientFactory` port — no hand-written JSON-RPC framing.
`stdio` and Streamable HTTP negotiate with `server/discover` first, selecting
the stateless 2026-07-28 era when available and falling back to the legacy
`initialize` era otherwise. Explicit HTTP/SSE remains legacy-only. Era verdicts
are cached for ten minutes per server configuration and authorization scope;
failures evict them. Settings records and shows `modern/stateless` or `legacy`
and the negotiated version. Discovery covers tools, resources/templates and
prompts. The SDK owns pagination, request-scoped SSE, cancellation, modern
per-request metadata and required HTTP headers, sessions for legacy servers,
and stdio child cleanup. A stdio child inherits only the SDK safe environment
plus that server's encrypted variables, never the full Pop Agent environment.
MCP results remain untrusted external content under §10. Full rationale and
contract cases: `docs/mcp.md`.
