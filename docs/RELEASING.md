# Releasing Pop Agent

This is the maintainer runbook for preparing a future GitHub release. It does
not authorize changing repository visibility or publishing from an unreviewed
checkout. The normative version and installation rules remain in
[`specs/Spec-Pop-General.md`](specs/Spec-Pop-General.md) and
[`specs/Spec-Pop-Installation.md`](specs/Spec-Pop-Installation.md).

## Release invariants

- Release only a semantic `X.Y.Z` version from an annotated `vX.Y.Z` tag.
- `main`, the local release checkout, the tag, the gate receipt, and the release
  artifacts must identify the same committed tree.
- Never release from a dirty, detached, behind, diverged, or local-ahead-only
  checkout. A commit that exists only locally has not passed the protected
  remote branch and CI path.
- Never move or delete a release tag and never replace a versioned artifact.
  Correct any mistake with a new version.
- Keep credentials out of commands, artifact names, notes, and logs. Use the
  GitHub CLI credential store or the GitHub web interface.
- Do not advertise a platform merely because it cross-compiles. Complete the
  platform acceptance checklist in the installation specification first.

## 1. Establish the release base

Start from the normal `main` checkout, fetch without rewriting it, and require
an exact match with the remote branch:

```sh
git fetch --prune origin main --tags
test "$(git symbolic-ref --short HEAD)" = main
test -z "$(git status --porcelain=v1 --untracked-files=all)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
```

The final comparison intentionally rejects both behind/diverged work and an
**ahead-only** local tree. Inspect existing versions and tags before choosing a
new version:

```sh
cat VERSION
git tag --sort=-version:refname | head -20
git log -1 --oneline --decorate
```

Confirm that the intended changes are in `CHANGELOG.md`, that no secret or
private deployment material entered history, and that the target version has
not previously been tagged or used for an immutable artifact.

## 2. Bump the version

Update all global-version owners in one release preparation change:

- `VERSION`;
- root, `shared`, `server`, `web`, `cli`, and `tools` `package.json` files;
- root and workspace version entries in `package-lock.json`;
- `cli/src/version.ts`;
- `local-access/tray/main.go`;
- the release heading/date in `CHANGELOG.md` when the release is being shipped.

The native launcher has its own compatibility version and is changed only when
launcher behavior or its compatibility contract requires it. Refresh lockfile
metadata after manifest edits without installing or publishing:

```sh
npm install --package-lock-only --ignore-scripts
npm run version:check
```

Review the complete diff, install exactly the locked dependency graph, and run
the full gate before committing:

```sh
git diff --check
git diff -- VERSION package.json package-lock.json shared/package.json \
  server/package.json web/package.json cli/package.json tools/package.json \
  cli/src/version.ts local-access/tray/main.go CHANGELOG.md
npm ci
npm run gate
```

The gate covers version/specification/self-map checks, lint, TypeScript, Go,
build, tests, and smoke. Do not edit any tracked file after it succeeds. Commit
only the gated release preparation, and do not tag it yet:

```sh
git add -- VERSION package.json package-lock.json shared/package.json \
  server/package.json web/package.json cli/package.json tools/package.json \
  cli/src/version.ts local-access/tray/main.go CHANGELOG.md
git commit -m "release: prepare X.Y.Z"
test -z "$(git status --porcelain=v1 --untracked-files=all)"
```

If the changelog was already prepared in an earlier reviewed commit, do not
stage an unchanged path. The commit records the same Git tree the gate checked.

## 3. Retain and verify the full gate receipt

The gate's final step writes a receipt under the worktree's Git metadata. After
committing the unchanged gated tree, verify that the receipt records the exact
`HEAD` tree:

```sh
receipt=$(git rev-parse --git-path pop-agent-gate-receipt.json)
node - "$receipt" <<'NODE'
const fs = require('node:fs');
const cp = require('node:child_process');
const receipt = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const tree = cp.execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
if (receipt.version !== 1 || receipt.tree !== tree || receipt.node !== process.version ||
    !Number.isFinite(Date.parse(receipt.completedAt))) {
  throw new Error('gate receipt does not match this committed tree and Node runtime');
}
console.log(JSON.stringify(receipt, null, 2));
NODE
```

Copy this receipt into the private release evidence directory. It is evidence,
not a substitute for the required successful `ci / gate` check on GitHub.

Push the release preparation commit normally, wait for `ci / gate`, then fetch
again and repeat the clean/exact-remote checks from section 1. Do not tag an
unpublished local commit, and do not use force-push to make the checks match.

## 4. Build immutable artifacts and checksums

Create artifacts only after the release commit is present on `origin/main` and
its required checks have passed. Use a new absolute directory outside the
checkout:

```sh
version=$(cat VERSION)
commit=$(git rev-parse HEAD)
release_root=/absolute/private-release-work/pop-agent-$version-$commit
mkdir -m 0700 "$release_root"
npm run pack:server-source -- --output-dir "$release_root/server"
```

The server packer refuses a dirty checkout, verifies the Git bundle, and writes
commit/version-named `.bundle` and `.sha256` files without replacing different
bytes. Verify both independently:

```sh
find "$release_root/server" -name '*.sha256' -execdir sha256sum -c '{}' \;
find "$release_root/server" -name '*.bundle' -exec git bundle verify '{}' \;
```

Create a new upload staging directory and populate it only from the verified
outputs. It must not pre-exist, which makes accidental artifact replacement a
hard failure:

```sh
upload="$release_root/upload"
server_release="$release_root/server/pop-agent-$version-$commit"
test -d "$server_release"
test ! -e "$upload"
mkdir -m 0700 "$upload"
find "$server_release" -maxdepth 1 -type f \
  \( -name '*.bundle' -o -name '*.sha256' \) -exec cp -- '{}' "$upload/" \;
test -n "$(find "$upload" -maxdepth 1 -name '*.bundle' -print -quit)"
```

When client artifacts are part of the release, run `npm run pack:cli` on the
supported build hosts. It creates the versioned CLI archive, launcher target
binaries, managed Node archives, manifests, and only the Pop Local Access
targets that the host can validly produce. A production macOS tray requires its
accepted native macOS build/signing/notarization process; a Linux cross-build is
not a substitute. Copy the exact current-version inventory into a new subtree,
preserving the directory structure consumed by the server:

```sh
client_upload="$upload/client"
test ! -e "$client_upload"
mkdir -m 0700 "$client_upload"
cp -- "cli/pack/cli-$version.tgz" "$client_upload/"
for directory in launcher local-access runtime; do
  test -d "cli/pack/$directory"
  cp -a -- "cli/pack/$directory" "$client_upload/$directory"
done
```

Never collect `cli/pack` wholesale because it intentionally retains historical
immutable CLI archives. Review `find "$upload" -type f -print` against the
expected release inventory before hashing. Then create and verify a release-wide
checksum manifest with relative, deterministic names:

```sh
(
  cd "$upload"
  find . -type f ! -name SHA256SUMS -print0 | LC_ALL=C sort -z |
    xargs -0 sha256sum > SHA256SUMS
  sha256sum -c SHA256SUMS
)
```

Keep the exact artifacts, `SHA256SUMS`, gate receipt, commit ID, build-host OS
and architecture, Node/Go versions, and platform acceptance results together.
Do not use `--clobber` with `gh release upload`.

## 5. Validate installers before tagging

For every advertised platform, follow the complete clean-machine obligations in
the installation specification. At minimum record:

1. checksum and bundle/archive verification;
2. fresh install on a clean supported machine;
3. repeat install/update over the running version;
4. corrupt and interrupted download refusal with the old version preserved;
5. login, restart/login-item behavior, update/repair, and removal with data
   preservation;
6. server `/healthz`, reported version/commit, and clean deployed checkout;
7. the public bootstrap fetched fully to an owner-only temporary file before
   execution—never a producer-to-shell pipeline.

Test the source bundle through `deploy/install-server-bundle.sh` with its exact
SHA-256 and commit. After public visibility is deliberately enabled, also test
`server-install.sh --prepare-only --ref <full-commit>` through an unauthenticated
HTTPS clone from a clean environment. Before that cutover, use the documented
authenticated GitHub CLI path; do not weaken the test by placing a token in a
URL or shell history.

A failed platform test removes that platform from the advertised artifact
matrix or blocks the release. It does not justify publishing partially tested
bytes.

## 6. Create the immutable tag and GitHub release

Immediately before tagging, fetch once more and repeat the clean, exact
`origin/main`, successful required-check, artifact checksum, and gate-receipt
checks. Then create and push one annotated tag:

```sh
version=$(cat VERSION)
tag=v$version
test -z "$(git tag -l "$tag")"
git tag -a "$tag" -m "Pop Agent $version"
test "$(git rev-list -n1 "$tag")" = "$(git rev-parse HEAD)"
git push origin "refs/tags/$tag"
```

Create a **draft** GitHub release from the existing tag with `--verify-tag`, add
release notes and the already checksummed artifacts, and independently download
the draft assets into an empty directory to verify names, sizes, and SHA-256.
Publish only after the draft asset inventory and installer receipts receive a
second-person review. Never let GitHub create a tag implicitly, never upload
with `--clobber`, and never replace assets after publication.

Repository rules must block update/deletion of `v*` tags. Enable GitHub's
immutable-release setting when it is available at public cutover. A changed
artifact, checksum, note that affects installation safety, or tag target always
requires a new patch version rather than mutation of the old release.

## 7. Public visibility cutover (separate owner action)

Changing visibility is not a release-script step. Before the owner performs the
one-time cutover:

- scan the complete Git history, issues, Actions logs/artifacts, release drafts,
  and repository metadata for secrets and private infrastructure details;
- confirm the MIT license, public README/install instructions, support/security
  contact, default branch, and unauthenticated HTTPS clone/raw-file access;
- restrict Actions to approved sources, keep workflow tokens read-only by
  default, require approval for outside-collaborator fork workflows, and do not
  expose Actions secrets to fork pull requests;
- create a `main` ruleset requiring pull requests and `ci / gate`, blocking
  force-push/deletion, and applying to administrators;
- create a branch ruleset that blocks creation of `v*` branch names, and a
  `v*` tag ruleset that restricts tag creation and blocks updates/deletion;
  enable immutable releases;
- enable private vulnerability reporting and verify the advisory form from an
  account without repository access; publication stays blocked if it is unavailable;
- enable Dependabot alerts/security updates, secret scanning, and push
  protection, then resolve or explicitly triage existing findings;
- enable CodeQL **default setup** for both `javascript-typescript` and `go`, wait
  for successful results for both languages, and add their checks to the
  `main` ruleset;
- run the unauthenticated clone, raw installer retrieval, clean-host install,
  checksum, health, and update checks before announcing availability.

No CodeQL workflow is committed pre-cutover: this private repository cannot
assume paid GitHub Advanced Security availability. Public-repository CodeQL
default setup supports both languages without storing another privileged
workflow in the repository. If GitHub does not detect and successfully analyze
both JavaScript/TypeScript and Go at cutover, keep publication blocked and use a
reviewed explicit two-language CodeQL workflow only after confirming feature
availability.

## Rollback and correction

- **Before a tag:** fix or revert the release preparation through normal commits,
  rerun the full gate, and obtain new review. Do not publish an ahead-only fix.
- **Tag pushed, release not published:** keep the tag immutable. Correct the
  issue in a new patch version and supersede the abandoned draft; do not delete
  or retarget the tag for convenience.
- **Release published:** never replace or delete its assets/checksums/tag. Stop
  rollout, use the server's recorded last-known-good activation path where
  applicable, publish a clear advisory, and ship the fix as a new version.
- **Visibility cutover failure:** stop announcement and release publication,
  preserve evidence, and let the repository owner decide visibility response.
  Credential exposure requires immediate provider-side revocation; rewriting
  Git history alone is not remediation.

After any rollback, verify service health, running commit/version, data
integrity, and checkout cleanliness. Record the failed version and reason so it
cannot be accidentally promoted later.
