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
compatible CLI is not silently downgraded. Launcher-owned `pop update` first checks the same-origin native launcher release,
verifies its size/hash and version probe, and replaces/restarts the launcher
when newer. Windows preserves the renamed running executable for rollback.
The same native check runs before bare chat launches and `--chat` continuation. It then requests CLI
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

Interactive chat validates the event ticket and SSE response before rendering the conversation or attaching local access. Authentication rejection gives the selected server login command and exits nonzero; it is never reported as an established connection dropping. API clients use renewed credentials for subsequent requests.

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

`/model` is available in help and autocomplete. With no arguments it opens an
inline searchable selector above the editor. Typing filters provider and model,
arrows move, Enter applies, and Escape closes only the selector even while a run
is active. The list contains Default (with its effective pair when provider
status makes that determinable), then valid recent pairs, then configured and
enabled providers' catalog pairs in deterministic provider order, deduplicated
by `(provider, model)`. An explicit current pair is visibly marked; when that
pair is absent from the current catalogs, the selector keeps it visible as
unavailable instead of presenting it as selectable. One failed catalog does not
hide successful providers and the selector identifies failures with `/model`
retry guidance; failure to load recent pairs is non-blocking.

`/model <provider-id> <model-id>` validates an explicit pair against the
configured, enabled provider and its current catalog before applying it;
`/model default` clears both fields. Catalog failure is distinct from an absent
pair. Other argument counts are rejected with usage guidance; model IDs may
contain `/`. Existing chats always PATCH provider
and model together. On a fresh lazy conversation, opening, cancelling, or
choosing Default creates nothing. Choosing an explicit pair may create the chat,
then PATCH it before a dependent first send. Lazy creation is single-flight
across sends, model changes and session commands, so concurrent actions cannot
materialize different chats. If creation succeeds and PATCH fails, the new chat
ID and its server-confirmed Default state remain selected and a dependent draft
is restored rather than sent with the wrong model.
`/new` clears the pair and invalidates old requests; switching or resuming loads
the persisted pair. `chat-model-changed` updates only the currently open chat's
header and selector without changing draft, filter, transcript, or run state.
The compact header shows either the explicit pair or Default/effective pair and
truncates to terminal width.

A model change never stops the active run. RunService snapshots a pair when a
run is admitted, so an already admitted active or global-capacity-queued run
keeps that pair. A per-chat durable follow-up row does not store a model pair;
when it later drains through `startRun`, it snapshots the chat's then-current
pair. Steering delivered into the current run therefore uses that run's pair,
while a future drained follow-up uses the newly selected pair.

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

Root `VERSION` identifies the server/web release. The Node CLI and launcher
have independent component versions and change when their own code ships. The server advertises minimum compatible
client/local-access versions; minimums move only for real wire breaks.

A bare `pop` launch and `pop update` check published versions and install only
newer releases. Equal versions open directly without reinstalling. Explicit
`pop update --repair` reinstalls the advertised CLI version, while preserving
the no-downgrade rule and all artifact checks.
Interactive `pop login` opens chat after successful authentication in the same
process, without repeating launcher update checks. Failed login never opens
chat. `--no-chat` and noninteractive output keep login-only behavior; PLA
installers use `--no-chat` so installation continues after authentication. Attach still enforces the minimum as defense in depth.
A compatible client may warn only when it is older than the downloadable CLI
selected by `cli/pack/package.json`, never merely older than the server. Missing
client archives must not trigger an update offer. Version checks never
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
implementation and saved backup password as Settings. Configure the independent
password in Settings → Backup before using `popman backup` in an operator
scheduler. Restore of `.popbackup` asks for its original password without echo;
legacy `.tar.gz` restore does not. Restore does not open the live database.
Restore stops the service before extraction and
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

A `--chat <id>` launch loads the selected active or archived chat, title,
stored messages and live snapshot before opening the editor. Unknown IDs and
missing arguments fail with actionable guidance and never create a chat.
Archived conversations remain read-only. Snapshot-covered stream events never
resurrect a completed run; switching chats invalidates outstanding sends from
the previous conversation.


## Windows product name

The user-facing terminal product is **Pop Agent CLI**, selectable independently
in Pop Agent Setup. The executable remains `pop`. Pop Agent Desktop uses a
private launcher even when the terminal component is unchecked; this does not
install a terminal command or grant local access. See the Installation spec for
per-user paths, preservation of existing installs and uninstall ownership.
