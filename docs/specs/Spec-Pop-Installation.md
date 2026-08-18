# Pop Agent — installation, distribution and updates

**Status:** normative
**Legacy coverage:** §15 updates
**Primary implementation:** `launcher/`, `local-access/tray/`, `server/src/interface/http/*installer*`, `server/src/application/update/`, `server/src/infrastructure/update/`, `server/src/manager/`, `web/src/services/pwa-*`
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
    screen, an enabled device-local PWA check, normal CLI startup, or an explicit
    operator action—not as telemetry.

Remote client installation requires HTTPS. Plain HTTP is accepted only for a
loopback development server. TLS authenticates the personal server and release
source; checksums detect corruption and bind downloaded bytes to the manifest or
script the client already received.

## Product installation topology

| Component | Owner / install mechanism | Current supported shape |
|---|---|---|
| Server | operator-managed Git checkout, npm workspace and systemd unit | Node 22.19+ host; production service shape is Linux/systemd |
| PWA | browser install UI and web manifest | modern Chromium, Safari/iOS instructions and other capable browsers |
| `pop` launcher | same-origin PowerShell or POSIX shell bootstrap | Windows/macOS/Linux release targets published by the server |
| Pop CLI | launcher-managed version directory | Node 22.19+ or a compatible Pop-managed private runtime |
| Pop Local Access | same-origin PowerShell/bash plus visible tray | Windows x64 and released macOS targets; permission starts disabled |
| pi runtime candidate | authenticated Settings action and server-side isolated staging | exact npm versions allowed by `piUpdatePolicy` |
| Pop Agent server update | prepared Git checkout plus external supervisor | clean committed checkout with a fresh gate receipt |

A release may advertise only targets whose exact artifacts were built and
packed. Source support in Go is not sufficient to claim a released platform.

## Fresh server installation

The current server installation is operator-managed rather than a public
one-command installer:

1. create or obtain the intended repository checkout;
2. install the required Node/npm version and workspace dependencies;
3. build and run the full repository gate;
4. configure absolute paths, user identity, data/workspace roots and environment;
5. install the production systemd unit and any narrowly scoped sudo policy;
6. bind locally and configure one supported HTTPS exposure shape;
7. complete first-run account setup through the PWA;
8. verify local and public health before treating the installation as complete.

The checked-in service unit is a template, not a portable universal installer.
A future server bootstrap must be specified and tested separately before the UI
or documentation presents it as delivered. It must not silently install or own
Tailscale, Caddy, FFmpeg, Git or system-wide Node. Those environment tools retain
their own package and security-update channels.

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
| versioned CLI tarball | one year, `immutable` | bundled CLI application package |
| `/cli-latest.tgz` | `no-store` redirect | migration alias to the exact current tarball |
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
platforms and malformed manifests are refused. Artifact handlers serve only a
filename named by the accepted manifest and verify the on-disk size.

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

`pop update` forces the same verified installation path as repair. `pop doctor`
reports launcher, CLI, Node/npm and server state without entering the TUI.
`pop --version` is local-only. An unreachable server stops a normal start because
the chat client has no useful offline mode.

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
- Vite uses prompt mode; a found worker raises an explicit reload banner rather
  than silently swapping the UI during use.
- Device-local settings control automatic checks and frequency. The current
  development default is enabled every 10 minutes; the choice lives only in
  `localStorage` and never becomes an account setting.
- While enabled, checks run on the interval and when the document becomes
  visible. Manual **Check for updates** remains available when disabled.
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
3. for automatic activation, a gate receipt for the exact Git tree, current Node
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

## Automatic server activation

Automatic activation is opt-in through durable server settings. It never means
a background `git pull`: only a checkout already prepared and proven by the
gate may be scheduled. The automatic coordinator:

- observes a prepared pending commit;
- waits for the configured idle interval;
- asks the same deployment coordinator to activate it;
- cancels its own waiting request when the setting is disabled or the candidate
  becomes invalid;
- cannot bypass clean-tree, exact-tree, idle, external-supervisor, health or
  rollback requirements.

Manual and automatic requests share one state machine. A service restart cancels
a process-local idle waiter; it does not pretend the wait survived.

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

- Production origins and downloads use HTTPS; only loopback development may use
  HTTP.
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

- origin derivation behind the supported reverse proxy;
- shell and PowerShell escaping;
- target/architecture selection;
- malformed, incomplete, duplicate and traversal-like manifest entries;
- missing pack behavior;
- no-store discovery and immutable versioned responses;
- size/hash mismatch and undeclared artifact refusal.

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
- enabled/disabled interval behavior and denied browser storage;
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
