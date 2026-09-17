# Changelog

## Unreleased

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
