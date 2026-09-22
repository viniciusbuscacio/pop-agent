# Changelog

## Unreleased

- Add native `/info` to web/PWA/Desktop and CLI help/autocomplete: selected and
  actual model/provider, SDK context estimate, scoped session messages/tokens,
  input/output/cache and tool counts, four-decimal estimated cost, mode and safe
  chat/session IDs. Preserve unknown/partial usage, context and pricing without
  prompting a model; retain busy locks and backward-compatible `/session`.

- Allow Loop reviewers to correct invalid read-only inspection arguments without
  permanently failing the phase. Explain the required evidence round in the tool
  contract and error; retain complete evidence coverage, tool budgets and terminal
  infrastructure failures.

- Fix Loop stopping before later reviews when cumulative Worker evidence exceeds
  200,000 characters: inspect immutable private snapshots through bounded pages,
  with per-round totals/hashes and explicit retained-log truncation. Preserve
  review evidence on later failures and return safe phase/code diagnostics,
  including artifact/cleanup failures. Corrections now require measurable
  next-deliverable progress toward the original goal; the UI distinguishes
  “Worker round finished” from objective completion.

- Give each Loop invocation its own inline card with planning, execution and
  review phases, correction counts, explicit workflow outcomes and expandable
  evidence/handoff details. Preserve tool ordering and historical progress;
  stopped work no longer keeps spinning. Loop progress now streams as cumulative
  newline-delimited snapshots without changing the API.

- Clarify release guidance wording so credential confidentiality and the source-build
  option do not falsely taint authorized local activation under the existing guard.

- Add `/loop <task>` to PWA and CLI chat commands. The server frames explicit
  owner requests for Loop on initial and steering turns, preserves original
  message text, clarifies bare usage and keeps Plan Mode read-only.

- Add explicitly requested Pop Loop: isolated Chat Model planning/review and
  Service Model implementation, bounded sequential corrections, real diff/test
  evidence and private patch handoff. Plan Mode and taint guards exclude it;
  nothing is automatically integrated, published or activated.

## 0.3.0 — 2026-09-12

- Lower the desktop sidebar footer divider by 2px to align with the composer.

- Standardize the automatic skill category and settings labels as Auto-Skills.

- Prepare the current Pop Agent codebase for its first public beta review.
- Start a new Git history; earlier development history is preserved in a private offline archive.
- Include Desktop and CLI, independent server/web releases, encrypted backups, and verified release recovery.

This release is private pending the owner's final review. Verified native
clients retain their original component versions and are distributed from this
release without depending on earlier private beta releases.
