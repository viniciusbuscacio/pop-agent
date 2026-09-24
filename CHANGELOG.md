# Changelog

## Unreleased — client distribution activation guard

- Refuse incomplete CLI/Local Access distributions before service activation, including prepared runtimes. Verify pinned client checksums, lazy catalogs, effective checkout identity, and HTTP bootstrap content.
- Provide a versioned local activation path and validate rollback clients; a failed preflight leaves the running service untouched.

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
