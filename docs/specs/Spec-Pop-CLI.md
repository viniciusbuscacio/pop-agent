# Pop Agent — client and operator CLIs

**Status:** normative
**Legacy coverage:** §17
**Primary implementation:** `launcher/`, `cli/`, `server/src/manager/`
**Related:** [`Spec-Pop-Installation.md`](Spec-Pop-Installation.md), [`Spec-Pop-Local-Access.md`](Spec-Pop-Local-Access.md), [`../cli.md`](../cli.md)

## Two programs, two trust boundaries

`pop` is the owner-facing terminal client installed on any computer. `popman`
is the server operator tool shipped with the checkout. They are separate
programs, not modes of one privileged binary.

The terminal is a normal Pop Agent client: chats, memory, provider execution,
usage, safety and persistence remain server-side. No model, provider credential,
agent loop, SQLite repository or server secret runs in `pop`. Its only durable
credential is an ordinary session token in an owner-only profile.

`popman` runs only on the server and may control systemd, backups and offline
account recovery. None of its powers is exposed as a CLI-authenticated HTTP
shortcut.

## Native launcher and TypeScript client

The installed `pop` executable is a small Go launcher. It must remain useful
when Node, npm or the active CLI is missing/corrupt. The launcher selects a
saved server, enforces remote HTTPS (loopback HTTP only), reads public release
metadata, installs/repairs the exact verified TypeScript CLI and then replaces
itself with that process.

The TypeScript CLI uses pi-tui for terminal rendering but never imports the pi
agent engine. HTTP/SSE DTOs are shared with the product. Every
`@pop-agent/*` client import is bundled into the packed release; external public
runtime dependencies remain installable without the monorepo.

Launcher `--launcher-version` needs neither profile nor Node. `pop version` is
the canonical user-facing version command and is local and side-effect free: no
profile read, server request, PLA attach or chat creation. `pop --version` and
`pop -v` remain undocumented compatibility paths for installed launcher and
package smoke probes. Runtime diagnostics/install are launcher-owned commands
and may bootstrap managed Node from the selected/supplied server.

## Installation and update

Public same-origin shell/PowerShell bootstrap selects the exact
OS/architecture launcher, checks size/SHA-256 and installs per user. The
launcher consumes `/cli/manifest.json`, immutable versioned CLI archives and the
verified same-origin managed Node release where supported. Exact cache,
staging, rollback and release rules are normative in Installation.

The active CLI lives in a private version directory with atomic active-version
state. A candidate is downloaded to temporary storage, verified, installed,
smoke-checked through `--version` and only then activated. A locally newer
compatible CLI is not silently downgraded. Launcher-owned `pop update` requests
repair/update and failed candidates preserve the prior active version. For a
legacy npm-global CLI, `pop update` installs the same-origin non-cacheable
`/cli-latest.tgz` alias without deriving a versioned filename from server update
status. Generated npm-global migration commands use the same alias, and legacy
success text refers to the latest packed CLI because that release may trail the
server version.

The launcher and CLI use no global npm install, sudo or shell `.cmd` dispatch.
Windows invokes npm's JavaScript entry through the selected `node.exe`.

## Profiles and authentication

A named profile stores normalized server origin and bearer session token in an
owner-only file. `pop login <url>` reads the password interactively without
argv/environment/history exposure. Any refreshed `x-pop-agent-token` is written
back atomically. Logout removes the selected token; `servers` lists profiles
without secrets.

Authentication failure stops blind reconnect and gives an actionable login
message. Profiles never contain provider credentials. Remote plain HTTP is
refused; `localhost`, `127.0.0.1` and `::1` remain valid development origins.

## User commands and chat behavior

Core commands are:

```text
pop
pop "question" | pop -p "question"
pop --chat <id>
pop login <url> | logout | servers | chats | update
pop local-access [--status-json]
pop version
```

A bare `pop` opens the interactive screen. A non-command argument is a one-shot
question. Conversations are ordinary server chats and synchronize with the PWA.
Continuation uses opaque chat IDs. `/quit` and `/exit` stop cleanly and print a
continuation command only after a server chat exists. The first Ctrl+C clears the
editor without exiting; a second consecutive Ctrl+C within 500 ms uses that same
clean quit path. Any other input or an expired interval requires a fresh first
Ctrl+C. Escape always interrupts the current run and never starts a new chat;
an open picker owns Escape until it closes. `/new` replaces the transcript, live
state, activity indicator and title with a genuinely clean new conversation.
`/archive` is available in help and autocomplete. It archives the current
persisted, idle chat with `PATCH /v1/chats/:id` and `{ archived: true }`, then
uses the same clean unpersisted reset as `/new`. With no persisted current chat
it makes no request and reports `Nothing to archive yet.`; while a run is active
it makes no request and points to `/stop`. A failed archive preserves the
current selection and transcript and reports the server error. The interactive
command has no confirmation and does not restore or bulk-archive chats.

The TUI renders persisted transcript plus live SSE projection, thinking when
enabled, tool lifecycle, queue/run state and stable failures. It does not poll
for streamed output or invent local transcript rows. Local execution notices
belong to the assistant segment that caused them.

An open transcript consumes `chat-archived-changed` for its own chat. If another
client archives it, the CLI keeps the transcript visible, marks it read-only and
shows one clear notice with `/unarchive` guidance; it does not switch chats,
prompt or restore automatically. A known archived state blocks sends locally
and retains the submitted text in the editor. A `chat_archived` send rejection
provides the same convergence for a direct `--chat` or an HTTP/SSE race: no
false user row remains, the draft is retained and later sends are blocked.
`/unarchive` is available in help and autocomplete, sends
`PATCH /v1/chats/:id` with `{ archived: false }`, keeps the transcript in place
and reenables sends only after success. With no current chat or a current chat
known to be open it makes no request; failure preserves the archived selection,
transcript and draft. `/archive` behavior is unchanged.

## Local Access inside the client

Interactive terminal chat and background tray supervision both reuse the PLA
library. PLA is not an agent and never creates a chat by itself. Server tools
retain unprefixed names; selected-computer tools are explicit `local_*` names.

The background command attaches with role `background`, emits line-delimited
status JSON for the native tray and obeys server policy. Interactive transport
may use role `interactive`. Stable machine identity, disabled-first permission,
WSS/HTTPS fallback, heartbeat, replay, limits and cancellation are fully
normative in Local Access.

The CLI does not implicitly lend local access merely because it sent a chat.
The message carries the selected stable machine identity according to current
client policy. Missing selection means server-only; dead/unknown enabled
selection is rejected and never rerouted.

## Version compatibility

Root `VERSION` is the product/Node CLI release. Launcher release is separate and
changes when launcher source ships. The server advertises minimum compatible
client/local-access versions; minimums move only for real wire breaks.

Ordinary launch updates compatible client code before attach when a newer exact
server release exists. Attach still enforces the minimum as defense in depth.
A behind-but-compatible version may warn without blocking. Version checks never
substitute for protocol negotiation.

## `popman`

Supported operator commands are:

```text
popman start | stop | restart | status
popman backup | backups | restore <exact-name>
popman reset-password
popman update
```

Service commands name the actual unit. Backup uses the same consistent snapshot
implementation as Settings. Restore stops the service before extraction and
starts it in `finally`; live HTTP restore is forbidden.

`reset-password` is shell-owner recovery when password and recovery key are both
lost. Host access is the proof of authority. It hashes the new password,
increments session epoch and prints a new recovery key once. There is no HTTP
equivalent.

`update` performs the operator-managed checkout/build/restart sequence described
in Deployment. `access-list` is explicitly not implemented and reports that
fact; historical proposal text must not imply an IP allowlist exists.

## Failure and test obligations

- launcher remains diagnostic without Node/profile/network as applicable;
- remote HTTP, malformed origins and unverified artifacts fail closed;
- candidate install failure keeps prior active state;
- `version` and the compatibility version flags perform no
  network/profile/local-access side effect;
- login hides passwords and persists renewal atomically;
- one-shot/interactive/continuation and terminal shutdown are tested;
- SSE reconnect converges to server transcript/queue;
- PLA transport/policy behavior shares server contract tests;
- `popman restore` proves stop → extract → start, including failure paths;
- packed releases install outside the monorepo on all supported platforms.
