# Changelog

## 0.3.2 — 2026-11-09

- Restore CLI Up/Down input recall for this interactive session, including commands
  and failed sends, while preserving multiline input and draft recovery.
- Rebuild the complete client distribution, including macOS installers.

## 0.3.1 — 2026-10-02

- Windows-first release: new Windows Desktop/CLI installers; no macOS Desktop installer in this release.

- Import encrypted backups through Settings with bounded streaming, upload progress and cancellation; restoration remains a separate confirmed action.
- Normalize included internal symbolic links in new backups and fail clearly on external or excluded targets rather than creating unrestorable archives.


## Unreleased — client bootstrap diagnostics

- Identify failed public manifest routes and HTTP/transport failure classes, with repair guidance instead of misleading offline messages. Doctor checks launcher metadata without updating.
- Add timestamped Local Access lifecycle/stderr logs with attempt, PID, elapsed time, exit status, retry delay, bounded failure context, and credential redaction.

## Unreleased — client distribution activation guard

- Refuse incomplete CLI/Local Access distributions before service activation, including prepared runtimes. Verify pinned client checksums, lazy catalogs, effective checkout identity, and HTTP bootstrap content.
- Provide a versioned local activation path and validate rollback clients; a failed preflight leaves the running service untouched.

## Unreleased

- Recover publication drafts omitted by GitHub's by-tag lookup using bounded,
  authenticated release-list pagination; refuse ambiguous matching releases.

- Fix flickering chat code blocks during streaming: keep current source and copy
  controls stable, then apply syntax highlighting after the answer settles.

- Automatically attach large plain-text pastes as UTF-8 text files in web/PWA/Desktop
  chat, preserving the draft and using the existing attachment archive flow.

- Add native `/info` to web/PWA/Desktop and CLI help/autocomplete: selected and
  actual model/provider, SDK context estimate, scoped session messages/tokens,
  input/output/cache and tool counts, four-decimal estimated cost, mode and safe
  chat/session IDs. Preserve unknown/partial usage, context and pricing without
  prompting a model; retain busy locks and backward-compatible `/session`.

- Maintain a persistent server-side Files metadata tree with incremental disk
  updates, authenticated conditional reads and daily full reconciliation.
- Cache Files metadata locally for immediate navigation and silently revalidate
  with authenticated ETag/304 requests shared by the page and sidebar. Keep
  last-good listings and Retry on failure, preserve selection/scroll, and reject
  stale mutation/logout results. The bounded, login-scoped IndexedDB cache never
  stores file bodies, thumbnails, links or credentials and remains optional when
  browser storage is denied or full.

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

## Unreleased

- Fix false credential detections when saving skills that mention passwordPlease
  or describe password/token handling. Continue rejecting labeled credentials
  and recognizable bare keys, including secrets beside an application name.

## 0.3.0 — 2026-09-12

- Lower the desktop sidebar footer divider by 2px to align with the composer.

- Standardize the automatic skill category and settings labels as Auto-Skills.

- Prepare the current Pop Agent codebase for its first public beta review.
- Start a new Git history; earlier development history is preserved in a private offline archive.
- Include Desktop and CLI, independent server/web releases, encrypted backups, and verified release recovery.

This release is private pending the owner's final review. Verified native
clients retain their original component versions and are distributed from this
release without depending on earlier private beta releases.
