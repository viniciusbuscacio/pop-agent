# Releasing Pop Agent

The owner-managed Ubuntu 24.04 AMD64 Docker builder on ubuntu-home is the
publication path. GitHub hosts source and immutable releases; hosted CI and
release Actions are disabled. Publish only at an owner-agreed batch boundary.
Repository visibility is a separate owner action.

## Prepare the agreed batch

Fetch origin/main and tags. The normal source checkout must be on main, clean,
and descended from origin/main; local commits ahead of origin are expected.
Never force-push, overwrite unrelated work or build a diverged batch.

Choose an unused X.Y.Z version and update VERSION, all workspace package.json
versions, lockfile workspace/root versions, cli/src/version.ts, the tray version,
the installer README examples and CHANGELOG.md. The native launcher retains its
independent compatibility version unless its behavior changes.

Run the version check and review the diff, then commit the release preparation.
Do not install dependencies or rerun the full gate on the host: the isolated
builder owns those checks for the exact committed tree.

## Build locally

```sh
./deploy/local-release.sh build
```

The builder uses a pinned Ubuntu 24.04 image, at most two CPUs and 4 GiB RAM,
and private persistent caches under ~/.local/share/pop-agent/release-builder.
It reuses unchanged dependencies, verified audio builds and successful exact-tree
gate receipts for at most 24 hours. A new source tree runs the complete gate
once: specifications, versions, generated metadata, lint, type checks, Go,
builds, tests and the application smoke.

The final package includes the production server, PWA, CLI, launchers, local
access, minimal audio-only FFmpeg and Whisper. Runtime pins and SHA-256 checks
remain enforced. Verify-only installation runs with npm, compilers, Python and
Go blocked. Build containers never mount principal data or publication credentials.

The output is stored under releases/<commit> in the builder state directory.
A verification marker is written only after production installation checks pass.
The publisher checks source identity and hashes again. Do not relabel old bytes.

## Publish the verified batch

Authenticate the publisher once with ./deploy/local-release.sh auth, supplying
the GitHub token through stdin from the credential store. Never put tokens in
arguments, URLs, logs or release notes. Only the publisher mounts credentials.

```sh
./deploy/local-release.sh publish
```

Publication requires the latest verified bundle to match the clean source HEAD.
It refuses an existing tag or release, creates an annotated vX.Y.Z tag and
atomically pushes the tag and main without force. It creates a draft from that
existing tag, uploads the verified assets without --clobber, and publishes as
latest only after successful uploads. Notes include the version's changelog
and build/validation provenance.

A failed push publishes nothing. A failed upload leaves an unpublished draft
for inspection; never overwrite a published asset or retarget a tag. Before
retrying a partially completed publication, inspect its exact state and preserve
all immutable identities.

After publication verify the GitHub release/tag commit, complete asset inventory,
sizes and checksums; fetch the tag back into the normal source checkout. Confirm
main matches origin/main. The test VM is restored and reinstalled by its owner;
do not mutate it as a side effect of release publication.

## Acceptance and public cutover

Use the installation specification's platform acceptance checklist. Changes to
installation receive fixture/terminal tests and the isolated prebuilt installation
probe before publication; the owner then repeats git clone plus bootstrap on the
snapshot-based test VM. Do not advertise a new architecture solely because it
cross-compiles. Server releases currently advertise AMD64 only.

## Public visibility cutover (separate owner action)

Public visibility and LinkedIn announcement require separate owner authorization
and a broader audit: source/history/log secret review, license and support/security
documentation, account/provider/backup/recovery flows, anonymous clone/install,
platform acceptance, and appropriate GitHub protection/security settings. Do not
reinstate hosted Actions or paid security tools implicitly during a release.
Enable private vulnerability reporting and verify its advisory form from an
account without repository access before public launch.

## Correction

Before publication, fix the committed tree and build it again. Once a tag or
release exists, keep it immutable and use a new version for changed bytes.
For an installed-server failure, preserve data and use the recorded last-known-good
activation path; verify health and the running version afterwards.


## First public release preparation

The intended first public version is `0.1.0`. Prepare it as a coordinated
source/client/bundle transition; existing `0.2.x` installations must not be
silently stranded by downgrade checks. Do not relabel an older bundle.

- [x] Explain the in-process pi TypeScript SDK boundary in the README.
- [x] Preserve the private Git history before any proposed history reset.
- [ ] Review encrypted backup setup in Settings with an owner-chosen password,
  create an encrypted archive, and verify restoration in an isolated directory.
- [ ] Prepare the agreed new Git history and synchronized `0.1.0` version,
  preserving the private backup and explicitly handling existing clients.
- [ ] Replace development release notes with the initial public changelog.
- [ ] Build and validate the exact final tree, then publish its matching bundle.
- [ ] Complete the public visibility and security-reporting checks above.
- [ ] Finalize the owner-approved LinkedIn announcement.

Backup encryption applies to new exported `.popbackup` archives. It does not
encrypt the live SQLite database, change FTS5 behavior, or rewrite legacy
`.tar.gz` archives. Restore authenticates and decrypts an archive before opening
its database. Source integration alone does not establish runtime activation;
verify `/v1/backups` reports `passwordConfigured` and archive encryption labels
before completing the owner acceptance item.
