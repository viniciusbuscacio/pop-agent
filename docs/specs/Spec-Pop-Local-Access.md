# Pop Agent — installed PWA and Pop Local Access

**Status:** normative
**Legacy coverage:** §17.1
**Primary implementation:** `server/src/application/local-access/`, `server/src/interface/http/local-tools-routes.ts`, `server/src/infrastructure/agent/local-tools.ts`, `cli/src/infrastructure/local-access.ts`, `local-access/tray/`, `web/src/routes/installation-section.tsx`
**Related:** [`Spec-Pop-Installation.md`](Spec-Pop-Installation.md), [`Spec-Pop-Events-Synchronization.md`](Spec-Pop-Events-Synchronization.md), [`Spec-Pop-Pi-Agent-Integration.md`](Spec-Pop-Pi-Agent-Integration.md), [`Spec-Pop-Security.md`](Spec-Pop-Security.md), [`../cli.md`](../cli.md)

## Purpose and product boundary

Windows offers one **Pop Agent Setup** with two independently selectable
components, both checked by default:

- **Pop Agent Desktop**: a Go/WebView2 window displaying the existing server UI,
  plus the visible computer-access tray and its private runtime.
- **Pop Agent CLI**: the `pop` terminal command and Start menu shortcut.

At least one component is required. Desktop-only setup never adds its private
runtime to PATH; CLI-only setup never installs a window or tray on a clean user.
An upgrade preserves existing components even if unchecked: unchecking is not
an implicit uninstall request. The installed component record drives Finish.

The browser-installed PWA remains available independently. macOS retains its
existing optional PLA tray and PWA arrangement; this Windows decision does not
claim a new macOS Desktop package.

The Windows Desktop native title bar defaults to dark colors independently of
the Windows theme. This default does not synchronize with the web theme.

Desktop is a view-only process: it loads the confirmed HTTPS origin (loopback
HTTP for development), keeps its WebView storage separate from browsers and
uses the ordinary web sign-in. Setup sign-in configures the local runtime/CLI;
it does not copy a token into the Desktop browser or override web sign-out.
Same-origin navigation remains inside; external HTTPS links open in the browser.
Credential-bearing URLs and other schemes are blocked. No native filesystem,
command, credential or generic Go binding is exposed to the loaded page.

Opening Desktop starts the existing tray process if needed. Closing the window
leaves computer access in the visible tray. Open Pop Agent in the Windows tray
opens the Desktop when installed, with browser fallback for legacy tray-only
installs. The server remains authoritative for permission and explicit machine
selection; installation does not enable or select local access.

## Architectural roles

| Component | Responsibility |
|---|---|
| PWA | install guidance, machine snapshot, permission switch and device-local machine selection |
| HTTP/SSE API | authenticated snapshots/actions and `local-machines-changed` invalidation |
| `LocalAccessPolicyService` | persistent server-authoritative permission for each stable machine |
| `LocalConnectionRegistry` | live transports, heartbeat, call routing, concurrency/output limits and revocation |
| local-tools routes | WebSocket/HTTPS transport adapter, frame validation and compatibility negotiation |
| `LocalAccess` CLI runtime | reconnect/fallback, local operation execution, cancellation and result transport |
| native tray | visible status/control, start-at-login and supervision of the CLI runtime |
| pi adapter | registers `local_*` definitions by redirecting pi’s ordinary operations to one selected connection |

Application policy does not import WebSocket, HTTP, Node child-process or pi SDK
types. The registry owns the live application abstraction; transport parsing is
at the HTTP interface edge; command/filesystem execution is on the client; pi
operation adapters remain infrastructure.

## Security and authority model

PLA is a privileged optional capability and follows deny-by-default rules:

1. A new stable machine is remembered with access **disabled**.
2. A valid authenticated transport may stay connected while disabled so policy
   changes and health remain visible.
3. The server refuses calls when the persistent machine policy is disabled.
4. The client independently refuses `call` frames while its synchronized policy
   is disabled.
5. The PWA sends a local selector only after an explicit choice in the visible machine selector.
6. No selector means server tools only; the server never chooses an arbitrary
   connected computer.
7. An unknown selector and a known enabled-but-offline selector are rejected
   with distinct typed errors before accepting the HTTP message. Neither ever
   falls through to server-only execution or another computer.
8. A known selector whose policy was switched off safely becomes server-only.
9. Local tool names are visibly prefixed (`local_*`); unprefixed tools always
   continue to mean the Pop Agent server.
10. Session expiry, password/recovery epoch changes and Sign out other devices
    terminate affected local transports and pending calls.

The permission is product state stored on the server, not a local tray
preference. PWA, tray and CLI all mutate the same policy through authenticated
channels and receive the resulting value. A compromised web view cannot reach a
local process directly; all routing passes through the authenticated server and
its selected machine policy.

## Stable machines and transient connections

A **machine** and a **connection** are different identities:

- `machineId` is a random stable identifier persisted per operating-system user;
- `connectionId` is generated by the server for one attached transport;
- hostname, platform, architecture, working directory and client version are
  descriptive metadata, never authority;
- reconnecting changes `connectionId` but preserves `machineId` and permission;
- the server updates descriptive metadata without resetting the permission.

The client stores its machine identity in an owner-only local state file:

- macOS: Application Support under the user profile;
- Windows: Local App Data under the user profile;
- Linux CLI: XDG state or the user’s local state directory.

A missing or damaged identity is replaced with a new UUID. This intentionally
appears as a new disabled computer; identity corruption must not inherit another
machine’s permission by hostname.

One machine may have more than one live transport—for example an interactive CLI
and the background tray. On macOS and Windows, PWA local access requires a live
`background` transport supervised by the visible tray; an interactive CLI
transport alone never makes that machine available to the PWA. If both roles are
connected, stable PWA selection resolves to the background transport. Linux
selection keeps its existing role-independent behavior. No load balancing or
failover to a different machine is allowed. PWA upgrades clear legacy persisted
`local-*` transport selections; those transient values must never be sent after
migration or presented as a second machine.

## Installation and tray lifecycle

Settings → Installation publishes same-origin PowerShell and bash commands.
Installation, integrity, runtime requirements, paths and rollback are normative
in the Installation specification.

The installed tray is intentionally small. It:

- starts `pop local-access --status-json` as a background-role client;
- parses line-delimited status JSON rather than scraping human output;
- shows Starting, Connecting, Access enabled/disabled, Authentication required,
  Update required and disconnected/reconnecting states;
- exposes the shared access switch;
- opens the configured Pop Agent origin;
- reconnects the supervised child;
- enables/disables start-at-login for the current user;
- opens the local diagnostic log;
- quits itself and its child.

The tray process does not host the web view, render Settings, store provider credentials,
open a local HTTP server or execute arbitrary tray-supplied shell text. Closing
the PWA does not stop PLA. Quitting PLA does not uninstall or sign out the PWA.

Transport attachment alone is not labeled “access enabled.” The tray waits for
the authoritative `access_policy` frame before presenting permission state.

## Authentication and session lifecycle

On macOS, the tray offers **Computer access → Sign in again…** and makes **Sign-in required** actionable.
Sign-in uses a native secure password dialog naming the configured server,
without Terminal, shell commands or a local listener. It calls the existing
password-login endpoint over HTTPS (HTTP only for explicit loopback development),
refuses redirects and shows sanitized authentication/network errors. Cancel
leaves the saved login untouched. Successful login atomically replaces the
owner-only default CLI profile and reconnects the supervised runtime, preserving
the machine identity and server-authoritative file-access permission. A changed
profile is not knowingly overwritten. Passwords never enter argv, logs or disk.
Disconnected/authentication-required states clear the tray's live permission
indicator. This native sign-in implementation is macOS-only; Windows parity is
not implied.

WebSocket upgrade and every HTTPS fallback request use the ordinary Pop Agent
bearer session. There is no second unauthenticated local-control secret and no
machine credential in a URL.

The attach records the verified session epoch and expiration. The registry:

- refuses an attach without a valid session;
- closes an expired connection at the heartbeat boundary;
- closes every matching epoch when sessions are invalidated;
- sends a stable closing reason before close when possible;
- settles pending calls as failed when a connection is revoked or detached.

A persistent background process makes an authenticated refresh request every six
hours because it otherwise performs no ordinary API calls that would receive a
sliding token. The refreshed profile token is used on the next reconnect. The
existing transport still obeys the expiration captured at attach and reconnects
with the newer token when its lease ends.

Authentication failure stops blind reconnect and tells the tray that sign-in is
required. Tokens and passwords never appear in tray status JSON or diagnostic
logs.

## Attach and compatibility negotiation

The first client frame is `attach`:

```json
{
  "kind": "attach",
  "protocol": 1,
  "role": "background",
  "machine": {
    "machineId": "stable-id",
    "hostname": "MacBook",
    "platform": "darwin",
    "arch": "arm64",
    "cwd": "/Users/owner",
    "clientVersion": "0.2.35"
  }
}
```

The server accepts protocol 1 (or an absent protocol from a compatible legacy
client), validates every field, rejects reserved/unsafe identity keys and applies
byte bounds before persisting machine metadata. Persisted records are rebuilt into
prototype-free validated maps when read. Unknown protocol revisions and invalid roles are rejected rather than
interpreted optimistically.

Compatibility uses the hand-maintained shared `MIN_CLIENT_VERSION`:

- below minimum or malformed/empty version: send `outdated` and refuse attach;
- at/above minimum but behind the server release: attach and send a nonfatal
  version warning plus the same-origin repair command;
- equal/newer compatible client: attach without warning.

The minimum changes only when an older client cannot survive the REST/SSE/local
frame contract. Ordinary server releases do not raise it automatically.

A successful attach returns transient connection identity, heartbeat interval,
transport and current access state. The server immediately publishes the same
access policy as a dedicated frame so all clients converge through one contract.

## Transport strategy

### WebSocket primary

PLA first opens authenticated WSS at `/v1/local-tools`, sends one attach and then
uses bidirectional JSON frames. The server’s WebSocket parser has the same 12 MiB
maximum payload as the HTTP fallback. An attached client arms a 45-second local
lease; every valid server frame refreshes it. Silent proxy/socket death therefore
causes termination and reconnect even if the OS never reports close.

### Authenticated HTTPS fallback

Some reverse proxies do not pass WebSocket upgrades. After two failures before
attach, PLA probes the ordinary HTTPS session endpoint. Only a successful
authenticated probe permits fallback to long polling:

1. `POST /v1/local-tools/connections` attaches;
2. `POST .../:id/poll` receives sequenced server frames and acknowledges the
   highest handled sequence;
3. `POST .../:id/events` sends bounded batches of client events;
4. `DELETE .../:id` closes explicitly.

Every request revalidates the bearer session and epoch. Polls wait for at most 25
seconds. Calls are handled outside the polling loop so a long command does not
prevent pings, output or cancellation.

Server frames remain queued until acknowledged. The queue is bounded by all of:

- 1,024 frames;
- 12 MiB aggregate UTF-8 payload;
- 12 MiB for any one accepted frame.

Overflow closes and unregisters that transport instead of retaining unbounded
memory or dropping an arbitrary middle frame. Event uploads contain at most 256
entries and a 12 MiB decoded request body, including requests without a trusted
Content-Length.

Client event IDs (maximum 256 UTF-8 bytes) make recent result/output delivery
idempotent. The server keeps a bounded 4,096-ID replay window; older IDs may be accepted again only after
they are too old to belong to a legitimate in-flight retry. The client likewise
keeps at most 1,024 completed call results for replay after duplicate delivery.
A disconnect kills local children and lets the server settle/retry at the run
boundary; replay state is not durable product history.

### Reconnect

Network close schedules exponential reconnect with jitter, starting near one
second and capped at 30 seconds. One outage produces one visible closed event;
retries do not spam status. A successful attach resets attempt state.

Explicit close, client-outdated refusal and authentication-required refusal do
not continue automatic reconnect. WSS fallback does not occur when ordinary
HTTPS is unreachable.

## Heartbeats, leases and detachment

The server sends a numbered ping every 15 seconds. Any valid client traffic
marks the connection heard; pong is the normal response. After three unanswered
beats (45 seconds), the registry:

- removes the connection;
- fails its pending calls;
- closes the transport;
- emits machine-state invalidation.

Heartbeats measure transport liveness, not command duration. A command may run
for minutes or hours while its client continues answering pings. The independent
client lease catches the opposite failure direction: an attached client that
stops hearing server frames terminates its own socket.

## Persistent permission lifecycle

On first attach, `LocalAccessPolicyService.remember` writes stable machine
metadata and preserves any prior `enabled` value. Permission changes may come
from:

- authenticated PWA `PATCH /v1/local-tools/machines/:id`;
- tray/CLI `set_access` over the authenticated PLA transport.

A successful change:

1. updates persistent server state;
2. sends `access_policy` to every live transport for that machine;
3. cancels every in-flight call when disabling;
4. emits `local-machines-changed` for all PWA clients.

Unknown machine IDs return 404. Disabling is immediate and idempotent. The
transport remains present so the machine can display and receive a later enable.

Known machine records remain after disconnect so permission does not disappear
with a laptop lid close or server restart. Presence is derived separately from
the live registry.

## Snapshots and PWA synchronization

Two authenticated snapshots have distinct purposes:

- `GET /v1/local-tools/connections` lists current transport instances and roles
  for compatibility/diagnosis;
- `GET /v1/local-tools/machines` lists deduplicated stable machines with
  persistent permission plus derived PWA-online state; on macOS and Windows,
  only a live background transport counts as online.

The Installation screen uses the machine snapshot initially, after
`local-machines-changed`, after EventSource reconnect and after foreground/BFCache
recovery. It does not poll periodically. Overlapping snapshot requests are
generation-guarded so a slower old response cannot overwrite newer state.

Attach, detach and permission mutation emit only the invalidation event, never a
partial connection-derived machine list. The Events Synchronization
specification defines ordering and resume behavior.

## PWA machine selection

Selection belongs to one browser/device and is stored in guarded `localStorage`.
It is not an account setting and is not inferred from the browser’s OS name.

Rules:

- server-only is the default, even when exactly one enabled computer is online;
- Devices uses one **Allow access to this computer** switch per named computer;
  turning it on grants server permission and explicitly selects that stable
  `machineId` for this browser only after the permission request succeeds;
- the switch is on only for the enabled computer selected by this browser.
  Selecting another computer leaves other computers' permissions intact for
  other browsers; it does not reroute existing runs;
- turning off the selected computer revokes its permission and clears this
  browser's selection, returning to **Server only**;
- show the active computer or **Server only** as plain status, and preserve
  online/offline state on each computer; there is no separate routing dropdown;
- enabling permission through the tray or another client never selects a
  computer automatically in this browser; errors retain the previous selection
  and display a retryable error; denied storage remains server-only;
- PWA upgrades clear the former selection key because older builds could fill it
  automatically; the user may explicitly select the machine again;
- selected machine becomes disabled or is no longer known: clear the local
  choice during snapshot reconciliation;
- selected enabled machine becomes temporarily offline: retain its stable
  choice while PLA reconnects;
- denied browser storage: remain server-only rather than guessing.

The common web API layer adds `x-pop-agent-local-connection` only when a stable
selection exists. The accepted PWA run or queue item keeps that stable machine
ID so a tray reconnect does not lose the user's routing choice. On macOS and
Windows, tool construction resolves the ID only to an eligible background
transport, then binds each operation to that exact transport; a later disconnect
removes local tools or fails an in-flight call and never falls back to an
interactive transport. Linux retains role-independent stable-machine resolution.
Known enabled machines without a live transport do not block message sends or
queue edits. The stable selector is retained. Offline local tool definitions
explain the limitation and fail immediately without server execution. A new run
after reconnect rebuilds the tools for the eligible transport. Unknown selectors
still produce `local_connection_unknown`. The legacy client retry remains only
for compatibility with older servers that return `local_connection_unavailable`.

The selector is captured with the message/queued input, not stored on the chat.
Two devices can use the same conversation while intentionally targeting
different machines. A later disconnect never reroutes that work to another
computer; if no selected connection remains when tools are constructed, the
`local_*` set is absent and only clearly server-scoped tools remain.

## CLI-originated local access

An interactive TUI keeps an `interactive` PLA connection for its lifetime and
sends its current transient connection ID with messages only while permission is
enabled. A one-shot `pop "question"` waits a bounded time for attach before
sending so its only message does not race its local capability.

The installed tray uses `background` role and remains connected independently of
PWA/terminal windows. If both interactive and background connections represent
the same stable machine, stable PWA selection prefers background; direct CLI
messages continue to name their own interactive connection.

## Agent tool projection

For an allowed selected connection, Pop Agent registers exactly:

- `local_bash` — shell command on the selected computer;
- `local_read` — read bytes from that computer;
- `local_write` — write a file on that computer;
- `local_edit` — edit using delegated read/write/access operations.

These are pi’s own Bash/Read/Write/Edit definitions with their operations
redirected through `LocalConnectionRegistry`. Schemas, rendering and truncation
stay aligned with the active pi SDK. The descriptions always name hostname,
platform/architecture, exact working directory and the fact that unprefixed
tools remain on the server.

If no permitted connection exists, no `local_*` definitions enter the session.
A local connection/machine change participates in pi session context revision so
a cached session cannot retain tools bound to an old transport.

Plan Mode exposes only `local_read`; `local_bash`, `local_write` and `local_edit`
are absent. External-content taint and command safety classify server and local
machines separately: local credential locations such as AWS, GitHub, npm, kube
and SSH files receive local-machine protections, and destructive/exfiltration
commands are blocked on both.

## Local operation contract and limits

The server permits at most four concurrent calls per connection. Calls have
unique IDs and support incremental output, final result and cancellation.

Client-side operation limits:

| Operation/property | Limit/behavior |
|---|---|
| command string | 64 KiB UTF-8 |
| path / working directory input | 16 KiB UTF-8 |
| read file | 8 MiB; result is base64 on JSON wire |
| write contents | 8 MiB UTF-8 |
| output per command/call | 50 MiB |
| output transport chunk | at most 64 KiB source bytes |
| optional command timeout | greater than zero, at most 86,400 seconds |
| server aggregate observed output | 50 MiB, independently enforced |
| live child processes | bounded indirectly by four server calls per connection |

`bash` runs through the platform shell in the requested working directory with a
sanitized copy of the local environment; Pop-specific token/password/secret/IPC
variables are removed. `read`, `access`, `mkdir` and `write` use direct Node
filesystem APIs rather than interpolated shell commands.

Stop, permission disable, transport detach, output overflow and timeout all
terminate the matching child (the process group on Unix where supported). A
server Stop sends `cancel`; the registry settles exactly once and decrements
concurrency. Client-side errors return stable classes such as `invalid_input`,
`not_found`, `permission_denied`, `spawn_failed`, `timeout`, `output_limit` or
`io_error` with a human-readable message.

PLA is intentionally not jailed to one directory: the owner enabled computer
access so the agent can work in explicitly requested local paths. Product safety
comes from explicit machine selection, visible prefixed tools, Plan Mode,
external-content taint, secret-path/command guards and user supervision—not from
pretending the whole computer is under the server’s Files jail.

## Failure behavior

- No session or stale session: reject attach/request and request sign-in.
- Invalid attach/protocol/metadata: protocol error or HTTP 400; never remember
  partial machine state.
- Client below minimum: refuse with actionable update data.
- Connected but disabled: remain visible, expose no local tools and refuse calls
  on both ends.
- Selected unknown machine: reject message/queue update with 409
  `local_connection_unknown`; the PWA clears that stale selection and explains
  the reset.
- Selected offline enabled machine: accept messages and queue edits while keeping
  the machine binding. Conversation continues; local tool calls fail clearly and
  promptly. Never substitute server operations for the selected local machine.
- Selected known disabled machine: continue server-only.
- Busy connection: fail the call rather than queueing unbounded work.
- Oversized frame/body/output/file: cancel/close with bounded memory.
- Heartbeat/session expiry: detach and fail pending operations.
- Proxy blocks WSS: authenticated HTTPS fallback after proof HTTPS works.
- Network outage: jittered reconnect; never switch machine.
- Tray child exits: tray reports disconnected and restarts after a delay unless
  quitting.
- Damaged stable ID: create a new disabled identity rather than borrowing old
  permission.

Background renewal reads the latest profile token for the original server on every request. After authentication refusal, PLA waits for the local profile credential to change before reconnecting; unchanged credentials and profiles redirected to another origin never trigger a retry. PWA offline guidance points to tray installation/startup and the explicit Server only choice without changing the selection automatically.

## Privacy, logs and diagnostics

Server journal entries include platform/architecture, role, shortened transient
connection identity and permission transitions. Rejected chat local selectors
also record the bounded selector, caller client kind/platform and whether the
selector was unknown or temporarily offline. They do not include bearer tokens,
password, message/attachment content, command output or user file contents.

The tray log records lifecycle/diagnostic errors and child stderr. Structured
status reports server origin, transport and access state only. The tray sanitizes
origins before display and never treats an arbitrary URL as executable content.

Hostname, platform, architecture, version and online/permission state are shown
only to the authenticated owner. The public installer surface contains no
machine inventory.

## Test obligations

### Policy and identity

- first attach is disabled;
- permission survives service recreation and metadata refresh;
- damaged/missing machine identity creates a protected stable UUID;
- background connection preference is limited to the same machine;
- multiple machines never cross-route;
- disable cancels calls and updates every transport.

### Authentication and lifecycle

- every WebSocket/HTTPS endpoint requires the bearer session;
- epoch revocation and expiration close only affected connections;
- heartbeat removes silent connections and preserves responsive long commands;
- explicit close does not reconnect;
- auth/outdated refusal stops retries;
- session refresh reaches the persisted profile used by reconnect.

### Protocol and resources

- protocol/role/metadata validation and byte bounds;
- WebSocket maximum payload;
- aggregate long-poll frame bytes and count;
- decoded HTTP body and event-batch bounds;
- bounded replay ID/result caches and duplicate idempotence;
- four-call concurrency and 50 MiB output cancellation;
- read/write/path/timeout limits and structured local errors;
- Stop and disconnect terminate children.

### Routing and UI

- absent selection remains server-only;
- unknown selectors return 409; known enabled offline selectors accept messages
  and queue edits without silently becoming server-only;
- installed-PWA message/queue retries retain one stable selector across a new
  transport ID, stop at the bounded grace deadline and do not retry other
  failures/actions;
- unknown persisted selectors clear while known offline selections remain;
- disabled known selector is safe server-only;
- stable machine resolves after reconnect and prefers its tray;
- one or several enabled machines remain server-only until the user explicitly
  turns on a computer's combined access switch in this browser;
- combined access selects after permission success, clears after successful
  disable, preserves selection on failure, and never revokes unrelated machines;
- denied localStorage remains server-only;
- initial/SSE/resume snapshots converge without polling;
- local tool descriptions identify the exact machine/directory;
- Plan Mode exposes only `local_read` and taint guards use local secret paths.

### Platform acceptance

Before calling a tray release supported, test on clean Windows and macOS users:
install, hidden login, disabled-first state, enable from PWA and tray, start at
login, reconnect after sleep/network loss, WSS-blocked fallback, command output,
Stop, password/session revocation, repair over a running tray, diagnostics, Quit
and removal behavior.

## Explicit non-goals

- running the agent engine or provider credentials in Desktop;
- silently granting access when PWA or tray is installed;
- auto-selecting an arbitrary one of multiple computers;
- opening a listening port on the local computer;
- sending provider credentials or server secret keys to PLA;
- treating hostname as identity or permission;
- routing a missing selected machine to another machine;
- exposing unprefixed tools with location-dependent meaning;
- using PLA transport as the browser SSE or software-update channel;
- claiming Linux tray support before a real packaged tray and desktop
  integration pass platform acceptance.

### Local file prerequisite dispatch

The CLI accepts structurally valid call envelopes and dispatches `access` and
`mkdir` alongside `read`, `write` and `bash`. Unsupported operation names return
an explicit correlated error result; they are never silently dropped. The same
access-policy check applies to prerequisite operations and file operations.

### Tray shutdown process tree

Tray Quit terminates the launcher and its descendants before cancelling the app context. Context cancellation must also terminate the whole process tree, never only the launcher. Closing the tray must not leave a background Node transport with local file access.

The Windows setup offers per-user **Pop Agent Desktop** and **Pop Agent CLI** Start menu shortcuts for installed components (selected by default). Desktop targets its web-window executable; CLI targets its terminal launcher. Creating or repairing this shortcut does not require administrator privileges.

The Windows tray release uses the Windows GUI subsystem, so launching it from Start or Explorer never opens a console window. The installer also starts it hidden. The CLI launcher remains a console application.

The Windows PLA setup wizard performs sign-in through its in-process binding, then provisions the verified managed Node and CLI runtimes without requiring Node on the shell PATH. No password or session token is passed to runtime subprocesses. Upgrading a running tray terminates its whole process tree before executable replacement.

## Removing a computer

Settings → Devices offers Remove computer with confirmation. DELETE
`/v1/local-tools/machines/:id` removes the visible record, denies local access,
cancels pending calls and closes all transports for that stable machine ID.
A persisted removal timestamp blocks automatic reattachment with credentials
from before removal, including sliding renewals and server restarts. A fresh
`pop login <server>` followed by restarting PLA permits registration again, with
file access disabled by default. Tombstones remain after re-registration so old
credentials never regain local attachment authority. Ordinary chat sign-in is
separate from revoking this local-tools binding. Clients clear a removed selected
machine; existing SSE invalidation updates other open Devices pages.


## Native installer update flow

The native Go tray owns its update discovery. It checks its configured Pop Server
at startup, every six hours, and on **Check for updates…**. Checks use public
release metadata only; they send no login token. HTTPS is required except for
loopback development. Redirects are rejected. Checks are bounded, serialized,
and canceled when the app quits. They never download installers in the background.

`GET /local-access-update.json?platform=darwin&arch=arm64` returns the current
version and installer filename, size and SHA-256 for the requested target.
`GET /local-access-installer?platform=windows&arch=amd64` is the stable,
non-cacheable browser download link: it redirects only to the current immutable
same-origin setup artifact. Supported targets are macOS arm64/amd64 and Windows
amd64. Missing targets return 404. A missing installer must not be reported as a
confirmed current version.
Only a strictly newer semantic version produces **Update available…** in the
menu. A failed check remains retryable and must not revoke local access.

Clicking **Update available…** downloads from `/local-access/<file>` on the same
configured server, with redirects rejected, a bounded size and timeout, and
SHA-256 verification before opening. Partial or corrupt downloads are removed.
The verified installer is saved in a unique Downloads subdirectory. The download
has a visible busy state and failures offer retry. No downloaded code runs before
integrity validation; opening an installer does not imply installation consent.

macOS uses a DMG with a **Pop Local Access Setup.app** wizard (Continue, Install,
Finish). Reuse the historical Pop Desktop Setup's pinned go-installer setup DMG
layout; do not ship the old desktop application or its credential wizard.
Windows uses a separate Wails executable backed by the pinned
`go-installer/windows` library, not a renamed tray or MessageBox sequence. The
family-style wizard supports both a clean per-user installation and an update:
Welcome → License → Components → Server/sign-in → Installation → Finish. It provides light
and dark themes, a fixed dedicated destination, progress, error/retry feedback,
and final shortcut, Start at Login and Open choices. It does not require a
terminal or an installed PWA. Existing saved sign-in may be reused only for the
same confirmed origin; a changed origin requires a new sign-in. HTTPS is required
except on loopback, login redirects are rejected, and secrets never appear in
returned UI state, subprocess arguments, subprocess environment or logs.

The Windows payload embeds version-matched tray/window-capable executable and launcher bytes and validates
size and SHA-256 before use. Source-only builds refuse installation; `--preview`
is explicitly non-mutating and does not read the owner's profiles. Dependency
preparation precedes replacement. Existing profiles, machine identity and server
permission are preserved, and installation never enables local access. The
existing startup choice is retained unless changed on Finish. A newer registered
PLA or compatible shared launcher must not be silently downgraded.

Cancel before Install performs no installation. Closing/canceling is disabled
while the transaction is active. The wizard reminds the owner to finish local
operations before continuing. It stops only the exact installed tray's process
tree. Previous program files and uninstall registration are restored on commit
failure; recovery failure is reported explicitly and backup bytes are retained.
Verified dependency caches may remain after a preparation failure. A failure to
start the installed tray on Finish is reported and remains retryable, never
reported as a successful launch.

The registered Windows uninstaller uses go-installer's helper handoff, restricted
to the exact installer-owned directory, shortcuts and registration. It removes
its CLI PATH entry, Desktop/CLI executables and startup entry, while retaining
shared profiles, separately installed launchers, WebView data, runtime caches and
server data. The uninstall wizard requires confirmation. The helper validates its
manifest before any removal.

macOS remains update-only: first-install commands remain in Settings → Install
Pop and Settings → Devices → Connect a computer. Its updater replaces only the
native executable, preserves owner state, and kickstarts the existing LaunchAgent
rather than racing bootout/bootstrap. Restart failure attempts restoration and
reports failure. Its setup invocation precedes the tray single-instance guard.

All published native setup artifacts are immutable, included in the server's
local-access manifest, verified by the publisher, and cached for
private-repository servers. By default, the Mac stage builds both architectures
and DMGs and verifies codesign/hdiutil; the Linux stage builds Windows and
requires the exact-commit Mac manifest before the gate. An explicit owner-chosen
Windows-first release may omit every Darwin PLA entry while retaining the
Windows executable and setup installer. Its build output must identify that
scope, macOS update discovery returns 404, and immutable macOS artifacts can
only return in a new version rather than being appended later. Ad-hoc macOS
signatures are not notarization. Public distribution must validate publisher
signing and platform prompts separately. Native installer acceptance testing
distinguishes compilation from actually running on each OS.

The routed built-in **pop-local-access** skill teaches these distinctions and
points to maintained implementation/specs. It is not pinned into every prompt.
Tests cover version comparison, malformed metadata, absent targets, download
integrity/redirects, installation cancellation and rollback, preserved user state,
and packaged installer inclusion. Neither the PWA refresh nor an updated CLI
version alone proves that the native tray was replaced.


## Compact native menu

The native tray has four top-level actions: **Open Pop Agent**, **Computer access**,
**Settings**, and **Quit Pop Agent Desktop** on Windows (**Quit Pop Local Access** on macOS). Use native submenus with platform arrows.
Computer access contains **Allow access to this computer** and, where native sign-in
is supported, **Sign in again…**. This permission still does not select a computer
in another PWA tab.

Settings contains **Start at Login**, the update action, and **Troubleshooting**.
Troubleshooting contains **Reconnect**, **Open logs**, and the configured server address (opens Pop).
The server address does not occupy a top-level row. Above the four actions,
a connection indicator reads **Server connected** with a green dot after transport
attachment, even when local access is disabled. It reads **Server disconnected**
with a neutral dot before attachment, after disconnection, authentication failure,
an unsupported version, or child shutdown. Its tooltip retains detailed state;
clicking retains reconnect/sign-in behavior. Permission is shown separately in
the Computer access checkbox. While a newer installer
is available, the parent reads **Settings · Update available**, including during
download and retry, so discovering the update does not require opening a submenu.

The macOS PLA bundle and setup wizard use the Pop logo as an ICNS app icon. The
tray embeds this asset and repairs its own installed bundle icon and
CFBundleIconFile on startup, so fresh installations and existing installations
receive the icon without changing login or local-access permission. Icon repair
failures are logged and do not prevent the local connection from starting. The
monochrome menu-bar template remains separate from the Finder/Spotlight app icon.
