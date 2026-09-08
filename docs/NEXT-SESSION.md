# Next session — public launch

Recorded on 2026-09-07. The owner postponed the launch.

- Expand the README's existing **Built on pi** section: explain the TypeScript SDK connection between Pop and pi. Pop embeds `@earendil-works/pi-coding-agent` in the server process. Pi provides agent execution, sessions and compaction; Pop wires providers, tools and context through its infrastructure adapter and owns authentication, persistence, integrations and the web/CLI experience.
- Review the new encrypted-backup flow in Settings with an owner-chosen backup password, then activate the validated runtime change. No production backup password was set during development.
- Resume the release/public-launch checklist in [RELEASING.md](RELEASING.md). Saving source to GitHub is not a release or a visibility change.

Owner clarification: leaving backups unencrypted was an earlier owner decision motivated by FTS5 concerns. Distinguish archive encryption from the live SQLite database: the new backup branch encrypts the exported archive only; live FTS5 operation is unchanged, and restore decrypts before opening the snapshot. Review this distinction before activation. Implementation is saved on `feat/encrypted-backups`.
