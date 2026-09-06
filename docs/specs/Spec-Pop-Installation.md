# Pop Agent — installation, distribution and updates

**Status:** normative
**Legacy coverage:** §15 updates
**Primary implementation:** `deploy/`, `tools/install-systemd.ts`, `launcher/`, `local-access/tray/`, `server/src/{application,infrastructure}/onboarding/`, `server/src/interface/http/{bootstrap-app,onboarding-routes}.ts`, `server/src/application/update/`, `server/src/infrastructure/update/`, `server/src/manager/`, `web/src/{routes/setup-page,services/onboarding}.ts*`, `web/src/services/pwa-*`
**Related:** [`Spec-Pop-Frontend.md`](Spec-Pop-Frontend.md), [`Spec-Pop-Local-Access.md`](Spec-Pop-Local-Access.md), [`Spec-Pop-Pi-Agent-Integration.md`](Spec-Pop-Pi-Agent-Integration.md), [`Spec-Pop-Deployment-and-Operations.md`](Spec-Pop-Deployment-and-Operations.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md), [`../cli.md`](../cli.md)

## Purpose and scope

Pop Agent is installed and updated as several deliberately independent
components:

```text
Pop Agent server checkout + systemd service
  ├── serves the browser PWA
  ├── publishes CLI, launcher, runtime and PLA releases
  ├── coordinates safe server and pi activation
  └── remains the authority for product data and policy

Browser / installed PWA          native `pop` launcher + Node CLI
Optional Pop Local Access tray   validated isolated pi runtime
```

This document defines their installation boundaries, distribution contracts,
version ownership, update activation, rollback, cache policy and release tests.
Production network exposure belongs to Deployment and Operations. Local-tool
permission and routing belong to Local Access. Exact pi session/runtime behavior
belongs to Pi Agent Integration.

The product has no native Pop Desktop wrapper. “Install Pop Agent” means install
the browser-owned PWA. Pop Local Access is a separate, optional tray component;
installing either one never implies installing the other.

## Core invariants

Every installation and update path must preserve these rules:

1. **No secrets in bootstrap material.** Public scripts, manifests, artifact
   URLs, argv, process environment and logs contain no password, session token,
   recovery key or provider credential.
2. **Exact immutable artifacts.** A versioned URL never serves different bytes.
   Mutable discovery endpoints and convenience scripts use `no-store`.
3. **Verify before activation.** Size, SHA-256, expected version and an
   executable smoke check are applied where the component supports them.
4. **Stage before replacing.** A failed download, extraction, dependency
   install, probe or health check leaves the active version usable or restores
   the previous version.
5. **No silent privilege expansion.** Client components install per user.
   Server restart supervision may use narrowly configured non-interactive sudo;
   general package/build work never runs as root.
6. **No silent downgrade.** A locally newer compatible CLI is not replaced by an
   older server package. Server/pi rollback is only to recorded last-known-good
   state after candidate failure.
7. **The initiating channel owns progress.** Software-update state is HTTP/local
   state, not a `StreamEvent` on the product SSE channel.
8. **Platform support is explicit.** Missing release bytes produce an actionable
   refusal or 404, never a guessed binary, substitute platform or partial
   success claim.
9. **Data is separate from replaceable code.** Updates do not overwrite SQLite,
   Files, Notes, skills, secrets or pi sessions as ordinary application bytes.
10. **Network activity is purposeful.** Update discovery occurs from the Updates
    screen, the fixed PWA update lifecycle, normal CLI startup, or an explicit
    operator action—not as telemetry.

Remote client installation requires HTTPS. Plain HTTP is accepted only for a
loopback development server and the fresh-install restricted bootstrap listener
on one RFC1918 address. That listener cannot accept credentials or product
traffic and exists only until private HTTPS and first-owner setup complete. TLS
authenticates the personal server and release source; checksums detect corruption
and bind downloaded bytes to the manifest or script the client already received.

## Product installation topology

| Component | Owner / install mechanism | Current supported shape |
|---|---|---|
| Server | Git clone, authenticated/fixed-ref GitHub acquisition, or verified local Git bundle, followed by non-root host bootstrap and prepared-checkout systemd installer | Ubuntu systemd on Linux amd64/arm64; fixed clean commit, prebuilt production package and pinned private Node/whisper.cpp runtime |
| PWA | browser install UI and web manifest | modern Chromium, Safari/iOS instructions and other capable browsers |
| `pop` launcher | same-origin PowerShell or POSIX shell bootstrap | Windows/macOS/Linux release targets published by the server |
| Pop CLI | launcher-managed version directory | Node 22.19+ or a compatible Pop-managed private runtime |
| Pop Local Access | same-origin PowerShell/bash plus visible tray | Windows x64 and released macOS targets; permission starts disabled |
| pi runtime candidate | authenticated Settings action and server-side isolated staging | exact npm versions allowed by `piUpdatePolicy` |
| Pop Agent server update | prepared Git checkout plus external supervisor | clean committed checkout with a fresh gate receipt |

A release may advertise only targets whose exact artifacts were built and
packed. Source support in Go is not sufficient to claim a released platform.

## Fresh server installation

The default fresh-server path is an ordinary Git clone followed by the delivered
bootstrap. Public instructions are inspectable before execution and use safe
per-user defaults:

```sh
git clone --depth 1 https://github.com/viniciusbuscacio/pop-agent.git
cd pop-agent
./deploy/bootstrap-server.sh --install-apt-packages
```

`--data-dir`, `--workspace`, `--port` and `--prepare-only` provide explicit
overrides. `--skip-network-onboarding` is the deliberate escape hatch for an
operator-managed Caddy/HTTPS deployment. A producer-to-shell pipeline is not an
installation command.

The root `server-install.sh` remains the fixed-ref GitHub acquisition path for
operators who need branch/tag/commit resolution or authenticated private/fork
access. When distributed as a remote file, it must still be downloaded fully
into an owner-only temporary file, inspected if desired, and invoked separately;
it must never be piped from a producer into a shell.

With no arguments the script targets `viniciusbuscacio/pop-agent` at `main`,
installs the checkout at `$HOME/pop-agent`, keeps durable data at
`$HOME/.pop-agent`, uses `$HOME/pop-agent-workspace`, and binds port 8787.
Explicit `--repo`, `--ref`, `--destination`, `--data-dir`, `--workspace`,
`--port`, and `--prepare-only` options support operator overrides and offline
testing. `--ref` accepts a branch, tag, or full lowercase 40-character commit.
A name present as both branch and tag is rejected as ambiguous rather than
letting a mutable branch shadow a release-looking tag. Resolution uses only refs
present in the completed clone, then pins one exact detached commit, so a mutable
branch advancing afterward cannot change activation. The
fresh-server invocation opts in to the host bootstrap's fixed apt prerequisite
allowlist by default; `--no-install-apt-packages` is available when the host is
already prepared.

Public repositories are acquired over HTTPS Git in an isolated Git home with
interactive prompting, askpass and credential helpers disabled. An already
authenticated GitHub CLI session is an optional source-access path for private
or access-controlled repositories and forks; when available, the script uses
`gh repo clone` plus exact-commit `gh api` confirmation. A public HTTPS failure
reports repository access and points private/access-controlled operators to gh
authentication. Neither path accepts a token argument or puts tokens in URLs,
argv, or installer logs.

The acquisition script refuses root, unsupported hosts, missing Git, unsafe or
overlapping paths, an existing destination, and insecure destination ancestry.
The canonical parent must be invoking-user-owned; every ancestor must be root-
or invoking-user-owned and non-writable by group/others, except a root-owned
sticky directory such as `/tmp`. Source staging is owner-only. Before and
immediately after no-replace activation it requires the exact commit, a clean
checkout, regular non-symlink required files including the pinned toolchain
manifest, and a canonical executable bootstrap inside that checkout. Staging is removed on
every exit. Once source activation succeeds, the checkout is intentionally
retained if later host preparation, gate, systemd activation, or health
verification fails. The failure output prints the exact direct-bootstrap retry
command; the acquisition command itself continues to refuse the now-existing
destination.

Bootstrap handoff uses a minimal explicit environment containing only the
service identity, home, PATH and locale; the printed retry command reproduces
that boundary. This excludes inherited token, askpass, Git-configuration and
SSH-agent variables. It does not make host credential/configuration files
inaccessible, and host permissions remain authoritative.

A verified local bundle remains an offline acquisition alternative. A clean
committed source worktree can produce an immutable local Git bundle and SHA file
through `npm run pack:server-source`. The packager refuses a dirty worktree,
requires repository-wide version consistency, names output by version and full
commit, verifies the bundle, stages output outside the checkout and never
replaces different bytes at an existing versioned path.

`deploy/install-server-bundle.sh` accepts only a local regular bundle plus an
explicit lowercase SHA-256 and full commit. It verifies the hash and Git bundle,
clones into staging, checks out that exact detached commit, requires a complete
clean Pop checkout, atomically activates a previously absent destination, then
hands explicit paths and options to the host bootstrap. It refuses root,
symlink bundles, unsafe paths, corruption, absent commits and existing
destinations. This alternative acquisition layer performs no HTTP request and
has no remote manifest behavior; local file transfer or bind mounting is
operator-owned.

All acquisition paths hand checkout/data/workspace/port values and
the selected apt/prepare options to the acquired checkout's delivered host
bootstrap. That bootstrap starts from an **existing Pop Agent checkout** on
Ubuntu Linux amd64/arm64:

```text
deploy/bootstrap-server.sh --install-apt-packages
```

It refuses root and unsupported platforms. An explicit
`--install-apt-packages` permits apt update/install of `ca-certificates`, `curl`,
`git`, `xz-utils`, `tar`, `libgomp1`, `libstdc++6` and `tailscale` through sudo.
Only missing prerequisites are installed; an already prepared host skips apt.
Whisper remains installed by default. FFmpeg is supplied as an audio-only binary
inside the verified server release, not through Ubuntu's multimedia package.
The normal path must not request X11, Wayland, SDL, fonts or video libraries. The official Tailscale key is verified
against the pinned size/SHA-256 before configuring its codename repository.
Normal installation does not install Python, C/C++ compilers or Go.

Pinned Node and whisper.cpp archives are downloaded concurrently, verified,
screened for unsafe paths/links, executable-probed and atomically activated in
the per-user toolchain. Cached bytes are reverified and reused on retries.
`--prepare-only` stops before application/systemd installation. The explicit
`--build-from-source` developer mode adds build-essential, Python, distribution FFmpeg and the pinned
Go runtime and retains the former npm ci/full gate/client packaging path.

Normal bootstrap invokes `tools/install-prebuilt.ts` with native Node TypeScript
support, without installing development packages. It acquires the exact
`v<VERSION>` server release from the checkout's GitHub origin; private releases
use the owner's existing gh login, while public downloads require no login.
Missing artifacts fail explicitly without a compilation fallback. A trusted
local `POP_AGENT_SERVER_RELEASE_DIR` is available for offline validation and
installation; it is never treated as an independently authenticated source.

The architecture JSON manifest must match version, exact source commit/tree,
Node version, Linux architecture and supported glibc, with positive bounded size,
SHA-256 and a successful gate timestamp. Prebuilt release builders run on Ubuntu
24.04 amd64/arm64. Archive validation rejects traversal, unexpected roots,
duplicates, hard links, special entries, escaping links and writes through a
symlink. Only ignored runtime paths (production node_modules, compiled outputs
and client manifests/current CLI tarball) may be extracted into a new isolated clone of the exact
source commit under the owner-only server-releases directory. Persistent data
and workspace remain separate. Verified downloads survive retries.

Release generation requires a clean committed tree and a fresh matching full
gate receipt. Packaging retains applied pi patches, prunes development packages
without install scripts, and removes ONNX native binaries for other platforms and unused CUDA/TensorRT
providers. It runs an offline Identity graph through the CPU execution provider.
It probes SQLite, Argon2, Sharp, embeddings and pi imports and runs the built
application smoke before publication. Both architecture jobs must pass before
publishing their immutable GitHub release assets. CI also extracts the package
through the real installation path with build commands replaced by failing
sentinels, without activating systemd. It must never overwrite a released asset.

The host runs only native probes and the 14-step built application smoke with
disposable data and a fake provider. Once staging succeeds, the shared systemd
installer validates ownership, clean Git state, Linux/systemd, separate paths,
Node and required host commands, then installs popman and the production service
using narrow sudo commands. The service uses the verified generation and its
managed Node and Whisper paths plus the bundled `POP_AGENT_FFMPEG`, offline pi bookkeeping, loopback-only binding
and bounded restart. A final health check and systemd active check are mandatory.
Failed replacement activation restores the previous unit/launcher and restarts
that service. Older generations remain available; there is no automatic deletion.
The existing explicit server/pi update validation is unchanged by this fresh
installation path and still requires its own preparation receipt.

For a fresh data root (or a rerun while its onboarding record still exists),
the installer chooses the first RFC1918 IPv4 address (or
loopback with an SSH-forwarding notice), opens a second listener on port 8788,
and prints its `/setup` URL plus a one-time 12-symbol code. Only a salted digest
of that code is written to the owner-only data root. It expires after 15 minutes,
is consumed by the first successful exchange, locks for one minute after five
misses, and can be replaced locally with `popman onboarding-code`. The main app
continues to bind only `127.0.0.1:8787`.

The temporary application mounts static setup assets, liveness/auth-mode
metadata and the onboarding routes only. After pairing, it drives `tailscale
up`, returns only a strictly validated Tailscale login URL, and polls daemon
state. One click must prepare and open sign-in: reserve a tab synchronously
during the click, clear its opener and navigate it once the validated login URL
arrives. Show preparation progress. If pop-ups are blocked, continue in the
current tab without requiring a second click. Close unused waiting tabs on
failure, unmount or an already-connected result. Retain a manual link for reopening
sign-in, while the original setup page polls connection state. Before Serve activation it explains that the device must share the
tailnet and requires explicit acceptance that the machine/tailnet FQDN appears
in public Certificate Transparency logs. It refuses an existing conflicting
Serve configuration rather than replacing it, never enables Funnel, and accepts
the master password only after verifying HTTPS on port 443 proxies exactly to
the loopback Pop origin. The owner continues on the verified `https://…ts.net`
origin; completing recovery-key acknowledgement deletes onboarding state and
closes the temporary listener.

An existing data root with no onboarding record is upgraded without adding a
Tailscale dependency or temporary listener. This preserves earlier Caddy/manual
deployments; the guided default applies only to a genuinely fresh setup.

Neither layer accepts or generates a secrets environment file. Provider and
account secrets remain in Pop-owned storage rather than argv, installer logs or
the unit. The removed ubuntu-home development unit is not a production
template; the TypeScript generator is the unit source of truth.

The operator must maintain the host, any required private or access-controlled
source credentials, the apt security channel and tailnet policy; complete the
explicit Tailscale authorization and first-run account setup; and verify health.
The host bootstrap itself does not install or own Linux, repository/source
acquisition, a public DNS zone, firewall, Caddy, Funnel or account setup, and it
does not modify system-wide Node or Go.

`deploy/configure-tailscale.sh` remains a separate repair/manual exposure helper
for skipped or existing deployments. It may run only after the loopback health
check passes and Tailscale is authenticated. It configures Tailscale Serve for
the loopback origin and never Funnel or tailnet policy.

## Installation guide in the PWA

Settings → Installation is generated from the origin that served the current
page. It shows:

- the exact server origin;
- browser-native PWA installation state/instructions;
- optional Pop Local Access commands and connected-machine permission state;
- CLI bootstrap commands for this server.

Examples must never contain a product-wide placeholder that could connect a
client to somebody else’s instance. Copy controls preserve the exact same-origin
URL. The screen does not claim installation merely because a command was copied;
PWA state comes from browser lifecycle events and Local Access state comes from
the authoritative server snapshot.

## PWA installation

`web/src/services/pwa-install.ts` captures Chromium’s `beforeinstallprompt` at
module load, before Settings may mount. The browser alone decides eligibility
and always owns final confirmation.

The UI has three states:

- **available:** show **Install Pop Agent** and call the retained prompt only from
  a user action;
- **installed:** standalone display mode, iOS standalone mode or `appinstalled`
  confirms the app;
- **unavailable:** show real platform instructions such as Add to Dock or Add to
  Home Screen; never display a dead install button.

A dismissed prompt is not success. The retained prompt is single-use and a page
cannot force installation, create operating-system entries itself or uninstall
the PWA. The browser owns the app window, shortcuts, permissions and removal.

## Public bootstrap and artifact surface

The following routes intentionally do not require an authenticated session:

| Route class | Cache policy | Purpose |
|---|---|---|
| `/install.sh`, `/install.ps1` | `no-store` | launcher bootstrap bound to this request origin |
| `/install-local-access.sh`, `/install-local-access.ps1` | `no-store` | optional PLA/tray bootstrap |
| `/cli/manifest.json` | `no-store` | active packed CLI metadata and compatibility minimums |
| `/cli/launcher/manifest.json` | `no-store` | exact launcher release metadata |
| versioned launcher binaries | one year, `immutable` | precompiled native launcher |
| versioned CLI tarball | one year, `immutable` | bundled CLI application package; retained releases remain downloadable at their original URLs |
| `/cli-latest.tgz` | `no-store` redirect | migration alias to the exact release selected by the current pack manifest |
| `/runtime/node/manifest.json` | `no-store` | pinned official Node provenance and same-origin package metadata |
| versioned managed Node archive | one year, `immutable` | verified private runtime bytes |
| versioned `/local-access/*` binary | one year, `immutable` | native tray release |

These routes expose product/runtime bytes and hashes, not account access. Making
them session-protected would force a bearer token into a shell command, URL or
temporary package-manager configuration. Authentication instead occurs
interactively after trusted bootstrap bytes are installed.

Release manifests are strict data boundaries. Versions, targets, filenames,
sizes and lowercase SHA-256 values are validated before a script or artifact is
served. Unknown targets, duplicate filenames, path separators, missing required
platforms and malformed manifests are refused. Manifest-selected artifact
handlers serve only accepted filenames and verify the on-disk size. Retained
CLI tarballs are the exception to single-manifest selection: before serving,
checkout-local releases are copied without replacement into the durable data
root, so an exact safe `cli-X.Y.Z.tgz` regular file remains available at its
immutable historical URL across checkout replacement. Malformed, symlinked,
conflicting and nonexistent names are refused.

## Native launcher and CLI installation

### Bootstrap

The POSIX and PowerShell scripts are intentionally small. They:

1. derive the exact target from OS and CPU architecture;
2. create a per-user launcher directory;
3. download the declared launcher from the same server;
4. verify SHA-256 before activation;
5. install it as `pop` / `pop.exe`;
6. add the directory to the user PATH when needed;
7. print the explicit login command.

No Go toolchain, global npm package, admin account or account token is needed to
install the launcher. The launcher is useful without Node for version output and
diagnostics.

### Normal startup and repair

For every normal TUI invocation, the launcher:

1. resolves the selected server profile;
2. normalizes the server origin and checks `/cli/manifest.json` with a bounded
   timeout;
3. validates minimum launcher/Node versions and package metadata;
4. selects a valid Pop-managed runtime first, otherwise compatible system
   Node/npm;
5. downloads a newer CLI package when required;
6. verifies exact size and SHA-256 and rejects a cross-origin redirect;
7. installs dependencies into staging through the configured package feed;
8. executes the candidate `--version` smoke check;
9. atomically activates its version directory and state;
10. replaces the launcher process with the Node CLI.

The launcher holds an install lock. A lock older than the recovery threshold is
considered stale; concurrent healthy installs wait for the owner. Candidate
files live under `~/.pop/cli/<version>` and activation state under `~/.pop/`.
Nothing is installed globally.

Launcher-owned `pop update` forces the same verified installation path as
repair. The legacy npm-global CLI's `pop update` installs the same-origin
`/cli-latest.tgz` alias directly and does not derive a tarball name from the
server version in `/v1/update/status`; its output identifies the server's latest
packed CLI rather than claiming that package equals the server version. Generated
npm-global migration commands use that alias as well. `pop doctor` reports
launcher, CLI, Node/npm and server state without entering the TUI. Canonical
`pop version` and the compatibility `--version`/`-v` paths are local-only. An
unreachable server stops a normal start because the chat client has no useful
offline mode.

A server package newer than active is installed. Equal starts immediately. A
locally newer version is not downgraded. Attach-time minimum-client negotiation
remains the final compatibility guard for a wire change that cannot support the
previous CLI.

### Managed Node runtime

The launcher can install a private Node/npm distribution under
`~/.pop/runtime/node/` when the server publishes a target for the client. The
runtime manifest pins an exact official `nodejs.org` source URL, byte size and
SHA-256; release packaging downloads and verifies those bytes before the server
publishes its same-origin immutable archive.

The launcher downloads that same-origin archive, enforces size/hash, rejects
path traversal, multiple roots, hard links, special entries and expansion/file
count limits, smokes Node and npm, then atomically records the active runtime.
Archive symlinks are not extracted; the launcher calls `npm-cli.js` directly.

`pop runtime install --server <origin>` supports first bootstrap before a CLI
profile exists. `pop runtime doctor` validates an existing managed runtime. A
target absent from the runtime manifest is an honest unsupported state; the user
must provide a compatible Node installation for that platform.

## Pop Local Access installation

Pop Local Access remains optional. Installing it performs a normal interactive
CLI login using hidden password input, then installs a small native tray which
supervises `pop local-access --status-json`. Password and resulting profile token
never enter the installer source, argv, environment, URL or logs.

### Windows

The PowerShell installer:

- installs/verifies the x64 launcher under `%LOCALAPPDATA%\PopAgent\bin`;
- requires a compatible Node runtime when no managed Windows runtime is
  published;
- runs interactive login;
- removes inherited ACLs from the Pop CLI profile and grants the current user
  full control;
- verifies the versioned tray binary before replacing anything;
- stops only the tray process whose executable path is the managed target;
- preserves the previous executable during replacement and restores/restarts it
  if activation fails;
- registers the visible tray in the current user’s `HKCU ...\Run` key;
- starts the tray without requiring administrator access.

Rerunning the installer is the update/repair operation and must work while an
older tray is running.

### macOS

The bash installer:

- installs/verifies the launcher under `~/.local/bin`;
- installs the published private Node runtime when neither compatible Node nor a
  valid managed runtime exists;
- runs interactive login;
- verifies the released tray binary;
- creates `~/Applications/Pop Local Access.app` as a menu-bar-only app;
- writes a per-user `LaunchAgent`, replaces any old loaded instance and starts
  the new tray.

The macOS tray is a native AppKit/CGO build and must be built on a compatible Mac.
A Linux cross-build must never stand in for a released macOS artifact. Public
distribution eventually requires the accepted Apple signing/notarization
policy; development artifacts must not be described as production-notarized.

The tray never hosts the PWA and contains no agent, provider credential or local
HTTP server. Its status/actions and server-authoritative permission semantics
are defined in the Local Access specification.

## PWA update lifecycle

PWA updates are browser/service-worker updates, distinct from server, CLI, PLA
and pi updates.

- `registerSW` runs exactly once from `web/src/services/pwa-update.ts`.
- Registration is prompt-capable internally, but a found worker activates
  automatically after its installation completes.
- Checks run every 10 minutes and when the document becomes visible. There is no
  device toggle or frequency setting; manual **Check for updates** remains
  available.
- Applying an update waits for the newest installing/waiting worker, requests
  activation, and reloads once after `controllerchange`; fallback begins only
  after installation can no longer complete normally.
- `sw.js` and the HTML shell use `no-cache` revalidation. Hashed assets use
  immutable caching.

A failed background check is silent and retried later. A manual check reports
unavailable, current, found or error. Service-worker state is local to one
browser profile; it is not server state and is never synchronized over SSE.

## Server release discovery and activation

Opening/refreshing Settings → Updates may query:

- the highest semantic `vX.Y.Z` tag from Git `origin`;
- npm’s latest stable pi package metadata;
- local boot, checkout and environment versions.

Results are cached for one hour. Failure omits the latest value rather than
blocking Settings. “Available” is shown only when a published semantic version
is strictly newer than current. Discovery never applies an update.

The boot commit and checkout `HEAD` are distinct. A checkout can be ahead of the
running process until activation. Safe activation requires:

1. a committed candidate at `HEAD`;
2. a clean worktree;
3. a gate receipt for the exact Git tree, current Node
   version and a completion no older than 24 hours;
4. passive waiting for active runs/tasks before admission closes;
5. a final identity/cleanliness/gate check after the idle wait;
6. handoff to a transient systemd unit outside the server cgroup;
7. service restart and bounded health check;
8. recording the candidate as last-known-good only after health succeeds.

If candidate health fails, the supervisor preserves the candidate under a
`failed-update-*` branch, resets to last-known-good, reinstalls dependencies,
rebuilds, restarts and health-checks again. A rollback failure is recorded as a
terminal failure rather than hidden.

A manual shell update remains supported for operator-managed deployments. It
must fetch/choose a commit, install dependencies, run the full gate and only
then restart. The update screen may copy this command but does not imply that
arbitrary dirty work can be safely activated.

## Server activation policy during beta

Server activation is explicit. Settings may inspect a clean prepared commit and
schedule activation after confirmation, but it does not fetch source or activate
in the background. Automatic server activation remains out of the beta until a
pre-update backup plus rollback contract is accepted and tested. A service
restart cancels a process-local idle waiter; it does not pretend the wait
survived.

## pi runtime update channel

pi is pinned exactly because an SDK release can break engine behavior even when
its package API still loads. The durable `piUpdatePolicy` is:

- `keep-current` — do not prepare another runtime;
- `recommended` — target the exact pi version approved by this Pop Agent release
  and used as the settings default;
- `latest` — evaluate npm’s latest stable version as an advanced channel.

Preparation installs the exact package graph in isolated staging with lifecycle
scripts disabled, records integrity and executes the zero-token behavioral SDK
probe. It never modifies live sessions. Activation waits for idle, snapshots pi
session JSONL, delegates restart to an external supervisor and accepts only a
healthy boot that imports the target version. Failure restores both the active
pointer and session snapshot before restarting last-known-good.

Exact probe/session contracts and candidate cache invalidation are defined in
Pi Agent Integration. A future probation or exact manual pin may not bypass the
same candidate validation and rollback path.

## CLI and PLA update cadence

The CLI is intentionally checked against its configured personal server on each
normal startup. This is not a product-wide telemetry call; it is the liveness and
compatibility check required before opening a server-dependent terminal client.
The launcher itself is replaced by rerunning the public bootstrap when a server
raises `minimumLauncherVersion`.

The PLA tray does not silently self-update. Rerunning its same-origin installer
is the current repair/update path. A future tray updater must preserve the same
manifest, checksum, per-user, interactive-auth and rollback rules and must not
be coupled to PWA service-worker activation.

## Failure behavior and recovery

- Missing or malformed release metadata returns 404/refusal, not a partially
  rendered installer.
- Download interruption or checksum mismatch never activates the candidate.
- Cross-origin CLI package redirects are refused.
- Missing Node produces a launcher/tray diagnostic; it does not corrupt an
  existing CLI or tray.
- Unsupported platform/architecture is named explicitly.
- A failed CLI dependency install leaves active state unchanged.
- A stale launcher update lock is recoverable; a live concurrent installer is
  allowed to finish.
- A suspended/stale PWA worker is handled through the explicit update lifecycle,
  never by clearing all browser data as the normal remedy.
- A server candidate that changes during idle wait is marked superseded and
  admission reopens.
- Restart/rollback outcomes are durable so a process exit does not erase the
  operator’s diagnosis.

## Removal and data preservation

- The browser removes the installed PWA and owns its local profile/storage
  choices.
- Removing a CLI/launcher or PLA installation is a local-computer operation; it
  must not revoke unrelated server sessions or delete server data.
- Quitting the tray stops the current local transport but does not uninstall the
  PWA.
- Server application removal must preserve `POP_AGENT_DATA_DIR`, workspace
  Files and backups by default. Destructive data removal requires a separate,
  explicit path and belongs to a future accepted server uninstaller.
- Removing Pop Agent must not silently uninstall or log out Tailscale, remove
  Caddy, system Node, FFmpeg, Git or other independently managed tools.

## Security requirements

- Production origins and downloads use HTTPS; only loopback development and the
  credential-free RFC1918 first-install listener may use HTTP.
- Installer-generated origins are escaped for their shell language.
- Shell scripts use strict failure behavior and temporary files with cleanup.
- PowerShell uses strict mode and terminating errors.
- Artifact names are manifest allow-listed, never arbitrary filesystem paths.
- Archive extraction is jailed and resource-bounded.
- Account login remains interactive; scripts never embed a session ticket.
- Client installation is per-user and does not require UAC/sudo in the normal
  path.
- Release/build logs contain versions, targets, hashes and failures but no
  credentials or private file contents.
- Package-manager lifecycle scripts are disabled for pi candidate staging. CLI
  dependencies are installed only during an explicit client install/update into
  a private version directory.
- Update checks and package acquisition are not telemetry and must not add
  analytics identifiers or unrelated requests.

## Test and release obligations

A release is not publishable merely because TypeScript compiles. The repository
gate and packaging process must cover:

### Installers and manifests

- prepared-checkout systemd rendering, preflight refusal, command ordering,
  narrowly scoped sudo activation and bounded health failure without touching
  a real systemd instance;
- origin derivation behind the supported reverse proxy;
- shell and PowerShell escaping;
- target/architecture selection;
- malformed, incomplete, duplicate and traversal-like manifest entries;
- missing pack behavior;
- no-store discovery/alias responses and immutable versioned responses;
- retention and exact serving of historical CLI archives across later packs;
- size/hash mismatch and unsafe, nonexistent or undeclared artifact refusal.

### Launcher and runtimes

- offline, DNS/TLS/timeout and HTTP diagnostics;
- remote HTTP refusal and loopback development acceptance;
- minimum launcher/Node checks;
- exact size/hash and cross-origin redirect rejection;
- install lock/stale lock behavior;
- staging, smoke, atomic activation and no downgrade;
- managed-runtime provenance, extraction jail and resource limits;
- same-origin runtime delivery, idempotence and checksum failure.

### PWA and PLA

- prompt available/installed/unavailable/dismissed states;
- single service-worker registration and one-reload activation;
- fixed interval/resume behavior and automatic-activation recovery;
- Windows tray replacement while running and rollback script shape;
- macOS app/LaunchAgent generation and missing-artifact refusal;
- no password/token text in installers;
- local permission remains disabled until the owner enables the computer.

### Server and pi activation

- dirty/unprepared/superseded checkout refusal;
- idle admission barrier and cancellation;
- external handoff, candidate health, failed-ref preservation and rollback;
- exact-tree gate receipt validation;
- pi integrity/probe/session snapshot/boot-stamp rollback contracts;
- end-to-end smoke after build.

Before publishing a platform artifact, perform a clean-machine install, repeat
install over the running version, corrupt/interrupted-download test, login,
restart/login-item test, update/repair and removal/data-preservation check on
that platform. Cross-compilation alone is not end-user acceptance.

## Explicit non-goals

- restoring WKWebView, WebView2, DMG, Setup app or a native Pop Desktop;
- silently installing the PWA or bypassing browser confirmation;
- placing bearer tokens in public bootstrap commands;
- treating SSE as a software-update bus;
- updating system tools behind the operator’s back;
- activating uncommitted or ungated server code;
- allowing a pi version to bypass isolated validation;
- claiming a one-command server installer before one exists and passes the full
  supported-platform matrix.

Managed Node runtime artifacts cover macOS, Linux and Windows on amd64/arm64. Windows uses the official ZIP archive and launcher 1.1.5 or newer; extraction rejects traversal, multiple roots, symlinks, special files and expansion beyond the runtime limit before activation. Release builders verify these archives; the server retrieves only the requested platform archive on demand.


### Minimal audio runtime and deferred client assets

Release builders compile the pinned, checksum-verified FFmpeg source on each
native supported Linux architecture. Disable autodetection, networking, video
devices and unused components. Enable only local audio container decoding,
resampling and mono PCM16 WAV output needed by Whisper. Include the LGPL license,
exact configure flags and corresponding source archive in the release. An
explicit POP_AGENT_FFMPEG override remains supported. Development source builds
may use the host FFmpeg when a bundled binary is absent.

Before publishing, test real speech conversion and real Whisper transcription
for WebM/Opus, fragmented MP4/AAC, M4A, WAV, MP3, Ogg/Vorbis, FLAC and AAC on both
amd64 and arm64. Native installation probes include conversion to 16 kHz mono
PCM16 WAV and reject missing or graphical dependencies. Compiler tools, source
archives, speech fixtures and test models are release-build inputs, not downloads
required by normal installation.

The server bundle retains the current CLI tarball and all platform manifests.
Launcher and PLA binaries are separate immutable GitHub release assets; Node
archives come from the exact official nodejs.org URL pinned by the manifest.
Existing same-origin client download URLs and hashes remain the contract.
A request for an allowed platform artifact triggers acquisition, exact size and
SHA-256 validation, atomic publication and reuse from an owner-only durable cache
under the data directory. Manifest requests do not trigger downloads. Coalesce
concurrent requests, reverify cached bytes and never serve failed or partial
bytes. A failed acquisition returns retryable HTTP 503. Unknown artifacts remain
404. Private GitHub assets use the server owner's existing gh authentication;
public releases need no authentication. No startup prefetch and no credential
material in public manifests or responses. Retain legacy complete packs.
