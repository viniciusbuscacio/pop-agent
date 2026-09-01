# `pop` — the terminal client, with Pop Local Access

Design for a new workspace (`cli/`) and the server changes it needs. The
spec stays normative (§17 needs the split described in "Naming" below);
this document explains what the CLI is, what it is *not*, and the one
genuinely new mechanism it introduces: **remote brain, local access**.

Decisions here came from design conversations on 2026-08-02 and
2026-08-04. Where the maintainer chose between options, that is marked
*(decided)*.

## What it is

`pop` is a chat client for the terminal. A conversation started in the
terminal is an ordinary Pop Agent chat: it appears in the PWA, it enters
memory, it costs from the same budget, it passes the same taint guard, it
gets the same title treatment. Nothing about it is a side channel.

The difference is where the agent's local tools are. Answering a message that
came from a terminal she has **two pairs**: the system tools she always
had, running on the server, and a second set running **on the machine
that typed it**. Pop Agent's own tools (memory, notes, skills, the Files
folder, `web_fetch`) keep running on the server, as always.

*(Revised 04/08. This first said the system tools MOVE to the terminal's
machine while one is attached, and that a `pop` on the MacBook therefore
had no access to the server's files — "local access follows the keyboard". Both
was chosen instead: she should be able to read a file on the server and
write it to the laptop in one turn, and moving the tools would have made
the same tool mean different machines depending on who was connected.)*

**Two sets, not one tool with a switch.** pi separates *what a tool is*
from *what touches the disk*, so the same `ToolDefinition`s are registered
twice with two `*Operations` implementations — same schemas, same limits,
same truncation. The server's set keeps the plain names (`bash`, `read`,
`write`, `edit`) because it is always there: a phone session has only
that one, and a tool must not change meaning depending on whether a
terminal happens to be open. The terminal's set is prefixed
(`local_bash`, `local_read`, …) and exists only in runs started from a
terminal. The system prompt says which machine each is, by hostname and
OS.

```
   MacBook / ThinkPad / the server itself          ubuntu-home (or any Pop Agent)
   ┌──────────────────────────────┐                ┌────────────────────────┐
   │ pop (TUI, pi-tui)            │                │  Pop Agent server      │
   │                              │   HTTP + SSE   │   ├ pi SDK (the brain) │
   │  transcript, editor       ───┼───────────────▶│   ├ memory, skills     │
   │  thinking, live output    ◀──┼────────────────┤   ├ taint guard        │
   │                              │                │   ├ cost, history      │
   │  pi's local operations    ◀──┼── local-tools ch. ──▶│   └ Files              │
   │  (bash/read/write/edit)      │                │                        │
   └──────────────────────────────┘                └────────────────────────┘
        local access                                        the brain
```

**This is not "the CLI runs an agent".** No model runs locally, no
provider key ever reaches the client, no prompt is assembled there. The
client holds one secret: a session token.

## What it is not

- Not a second brain. The alternative — a pi extension running the loop
  locally against Pop Agent's REST API — was considered and rejected: it
  duplicates the head, loses the taint guard, loses `llm_runs` accounting,
  loses multi-provider fallback and layered compaction, and the chat only
  reaches the PWA after the fact.
- Not an operator tool. Service control lives in `popman` (see Naming).
- Not offline-capable. The server is the truth; there is no local cache.

## Decisions

| Question | Decision |
|---|---|
| Local access opt-in or always? | **Always on**, no flag *(decided)* |
| Does `cwd` matter? | **No.** No trust prompt, no project concept. The whole machine is the ground; the launch directory is only where `bash` starts *(decided)* |
| `pop` run on the server itself? | Same rule, no special case: local tools are "the machine that typed", which there happens to be the server *(decided)* |
| Confirmations | **Yolo**: never ask *(decided)* |
| Taint guard | **Stays on, and learns which machine it is guarding.** The threat it answers is injection (a web page telling her to read `~/.ssh/id_rsa`), not the maintainer *(decided)* — see Guarding two machines |
| Local-tools channel | **WebSocket** *(decided)* — see Why a WebSocket |
| Dead local connection | **Heartbeat**, 15 s ping, gone after three unanswered *(decided)* — see Losing local access |
| Whose local access are they? | **The sender's.** A message carries local access of the machine that typed it, for the whole run it starts. There is no owner, no takeover, no spectator *(decided 04/08)* — see Whose local access |
| Tool behaviour | **Reuse pi's own operations**, not a re-implementation *(decided)* |
| Long commands | No timeout while the local-tools channel is alive and heart-beating; the run dies when the channel dies *(decided)* |
| Live output | Printed **locally, as it happens**; the server receives the final result. No reverse streaming in v1 *(decided)* |
| Interactive commands (`vim`, `sudo`, `[y/N]`) | Whatever pi's bash tool already does — inherited, not designed *(decided)* |
| Machine awareness | Inject hostname, OS, architecture and cwd into the prompt. Start there, refine later if needed *(decided)* |
| Thinking | Visible by default; streamed, dimmed, toggleable with `/think`, preserved after settlement, and remembered per machine *(decided)* |
| Where files land | The existing tool split already answers it: `local_write`/`local_edit` touch the machine that typed (your Obsidian vault, your repo); the server's own `write` into `Files/` lands in the user's Files tab. The model already chooses between them *(decided; revised 05/08 — `save_artifact` and the artifact catalog are gone, Files is a plain folder)* |
| Language | **TypeScript** *(decided)* — see Language |
| Client/server version mismatch | **The server sets a minimum and the attach enforces it**: silent when compatible, one dim line when merely behind, refused with the install command when below the minimum. Never a silent auto-update *(decided)* — see Version compatibility |

## Language

TypeScript, as a fourth workspace in the monorepo, inside the same gate.

*(Rewritten 04/08. The three reasons below were written before step 3
existed. Two of them turned out not to survive it, and leaving them
standing would mean a future reader either reopens this on a false
premise or accepts it without checking. The decision is unchanged; the
reason is now one thing, not three.)*

**The reason is `@earendil-works/pi-tui`.** Published standalone at pi's
own version, in lockstep: differential rendering, `Editor` with IME
support, key parsing across terminals including the kitty protocol,
bracketed paste, markdown to ANSI, autocomplete, fuzzy matching, and
pi's own keybindings. "Looks like pi" is a dependency instead of a
project, and `npm update` brings next year's terminal fixes too. That is
the whole of it, and it is enough.

The two that did not survive:

1. ~~**pi's local operations.**~~ The plan was for the terminal to run
   pi's `createLocalBashOperations` and friends, so that output
   truncation, file size caps and error shapes would not be
   hand-written twice. Step 3 did the opposite and better: the
   definitions and every rule in them stay on the **server**, and the
   terminal end is only a disk and a shell — about sixty lines of
   `spawn` and `fs`. Nothing to re-implement means nothing that can
   drift, in any language.
2. ~~**`@pop-agent/shared` for compile-time wire coupling.**~~ Real, but
   small: the wire is a handful of REST calls, the `StreamEvent` shapes
   and local access frames. Another language would hand-write those structs
   and cover them with a contract test. Worth something; not worth a
   language.

**The TUI remains TypeScript; the stable launcher is Go** *(revised 14/08)*.
Rewriting the screen in Go would still throw away pi-tui and permanently own
terminal rendering. The updater has the opposite constraints: it must remain
able to explain a missing Node/npm, an offline server or a corrupt CLI, so it
cannot itself depend on Node or on the files it replaces. The installed `pop`
command is therefore a small precompiled Go launcher; it checks and atomically
installs the versioned Node CLI, then replaces itself with that CLI process.
Users install a platform binary, never the Go toolchain.

## Distribution

**The server serves its own launcher and client.** macOS/Linux bootstrap with
`GET /install.sh`; Windows uses `GET /install.ps1`. Both scripts derive the
server origin from the request, choose a precompiled launcher for the local
platform, validate its published SHA-256 and install it as `pop`. The launcher
then reads the selected server and requests public, non-cacheable
`GET /cli/manifest.json`:

```json
{
  "version": "0.2.23",
  "minimumNodeVersion": "22.19.0",
  "minimumLauncherVersion": "1.0.0",
  "package": {
    "url": "/cli-0.2.23.tgz",
    "size": 1837421,
    "sha256": "..."
  }
}
```

The exact tarball and launcher binaries are immutable; manifests and installer
scripts are `no-store`. Packaging retains older `cli-X.Y.Z.tgz` tarballs, so an
existing versioned URL remains downloadable while the manifest selects the
current packed release. The launcher installs the tarball's external npm
packages through Microsoft's Package Feed Proxy
(`https://packagefeedproxy.microsoft.io/npm/`), avoiding a direct dependency on
`registry.npmjs.org`; the tarball itself still comes only from the configured
Pop server and is verified before npm sees it.

The legacy `/cli-latest.tgz` alias remains for old npm-global installations. Its
non-cacheable redirect always resolves to the immutable versioned artifact
selected by the pack manifest, which can briefly trail the server version. A
legacy reinstall can therefore keep one stable command:

```sh
npm install --global https://your-pop-agent.example/cli-latest.tgz \
  --registry https://packagefeedproxy.microsoft.io/npm/
```

The native launcher remains the primary setup path. Legacy `pop update` uses
this alias directly rather than deriving `cli-X.Y.Z.tgz` from server update
status, and reports that it installed the latest packed CLI rather than claiming
the server version was installed.

*(Corrected 04/08. This first said the reason was that "the client cannot
drift from the server it talks to". That is only true on the day of the
install. The server moves to 0.3 and the laptop keeps the 0.2 it was
handed — the same mismatch, arrived at from the other side. Serving the
tarball is still the right choice; it just is not what stops drift. That
is the next section, and it has to exist either way.)*

### Version compatibility and startup

For normal invocations the launcher checks the configured server before Node or
the TUI starts. No configured server prompts for an HTTP(S) origin; the first
successful launch hands that origin to the CLI's normal authenticated `login`.
The manifest request itself is the liveness check — there is no redundant health
request.

- Offline, DNS, TLS, timeout and HTTP failures are diagnosed and stop; an offline
  chat client has no useful mode to enter.
- Missing or old Node and missing npm are diagnosed by the launcher, which keeps
  working without either dependency.
- A newer server package downloads to a temporary file, verifies byte length and
  SHA-256, installs under `~/.pop/cli/<version>`, runs `--version` as a smoke
  check, and only then atomically writes the active-version state.
- Equal versions start immediately. A locally newer version starts without a
  downgrade. `pop update` forces a repair/reinstall; `pop doctor` diagnoses the
  launcher, dependencies and server without starting the Node CLI.
- `--version` remains a local-only path.

The attach-time minimum-client check remains a final wire-compatibility guard,
but ordinary drift is removed before attach rather than merely announced.

**Knowing when to raise the minimum** is a judgement, not a detection.
The wire lives in few places — the `/v1` routes, the `StreamEvent`
shapes, local access frames. A commit that touches one of them is the cue to
ask whether the previous client survives it. A test that fails when those
files change without the number changing is worth having as a prod; it
cannot make the call.

**The whole of it**, once per machine:

```sh
curl -fsSL https://your-pop-agent.example/install.sh | sh
$HOME/.local/bin/pop login https://your-pop-agent.example
```

```powershell
powershell -c "irm https://your-pop-agent.example/install.ps1 | iex"
pop login https://your-pop-agent.example
```

Node remains required for the TypeScript TUI. It is deliberately *not* required
for the launcher or its diagnostics. npm is used only to install dependencies
inside the launcher's private version directory; nothing is installed globally,
no `sudo` is needed, and a failed candidate cannot overwrite the active CLI.

**What actually lands**, measured 04/08 — 2.9 MB, no compilation:

| | |
|---|---|
| `@earendil-works/pi-tui` | 2.0 MB |
| `marked` (pi-tui's) | 460 KB |
| `ws` | 196 KB |
| `get-east-asian-width` | 36 KB |
| the CLI's own `dist/` | 244 KB |

Nothing in it compiles. `pi-tui` does ship prebuilt `.node` binaries for
macOS and Windows (see Naming) — native files, but downloaded ready, not
a build step, and Linux has none and degrades without them. What does NOT
come: `better-sqlite3` and `argon2` (both compile C++),
`@huggingface/transformers` (hundreds of MB), React, vite, the PWA,
playwright, the server. That list is the whole point — telling someone to
clone the monorepo and `npm install` hands them all of it to build a chat
client.

**The server hands over the shell, not the contents.** The 49 KB tarball
comes from your machine; the 2.9 MB of dependencies still resolve from
the public registry. That is fine everywhere it is meant to run, and it
closes one door: a machine walled off from npmjs is not helped by this
route at all. It is the same machine as the "no Node" case in Language,
and it stays where that section put it.

**One thing blocks it today, and it is measured, not guessed.** `npm pack
-w @pop-agent/cli` produces a 49 KB tarball that does not install:

```
npm error 404 '@pop-agent/shared@*' is not in this registry
```

`@pop-agent/shared` is a workspace dependency; outside the monorepo npm looks
for it on the public registry and finds nothing.

**The rule that fixes it, stated generally**: the build bundles every
`@pop-agent/*` import into the CLI's own `dist/`, and leaves `pi-tui`, `ws`
and `marked` external. The published `package.json` then lists three
public dependencies and no workspace ones, and packing works regardless
of how much of `shared` the CLI grows into.

Today that is three string constants and inlining them by hand would do.
Stating it as a rule instead costs nothing now and settles the question
left Open below: if the `StreamEvent` reducer moves into `@pop-agent/shared`
to stop being written twice, packaging does not notice. Sized for the
small case, the rule would have had to be redone for the large one.

This is a partial bundle, and it belongs in the comparison below: it
keeps `pop` a command on the PATH, unlike the full bundle, and keeps the
wire types shareable, unlike hand-inlining.

**Two details still to decide.** The tarball route must answer without a
session, because npm cannot log in — a new public surface, which §18 has
rules about. And npm caches by URL, so the filename needs the version in
it or an update silently installs the old one; this is why the version is
in the path everywhere it appears above, including in the line the client
prints when it is behind. Settings → About showing the current command is
then a convenience, not the mechanism.

**Alternatives measured the same day**, kept so they are not re-derived:
a single esbuild bundle is 460 KB and runs everything with no
`node_modules` at all — but it is `node pop.mjs`, not a command on the
PATH, and it must be ESM **with a `createRequire` banner**, because plain
ESM dies on a dynamic `require` inside a dependency and plain CJS dies on
`import.meta`. A Go binary would be ~10 MB and need no runtime; see
Language for why that is not the trade being made. A Node SEA is ~120 MB,
because it carries the whole Node binary, and needs codesigning to
cross-build for macOS.


## Naming

- **`pop`** — the client. New workspace `cli/`, package `@pop-agent/cli`,
  installable anywhere. *(Correction, 04/08: this said "no native
  dependencies". `pi-tui` ships prebuilt `.node` binaries for macOS and
  Windows -- `darwin-modifiers`, `win32-console-mode` -- so the claim was
  wrong. They are prebuilds, not a compile step, and Linux has none and
  degrades without them, so nothing about installability changes; but the
  sentence that the packaging question rests on has to be true.)*
- **`popman`** — the manager: `start | stop | restart | status` of the
  Pop Agent service, plus `backup | backups | restore | reset-password |
  update`. Ships with the server, runs only there, touches SQLite,
  `secret.key` and systemd. (`access-list` is in spec §18 and is not
  built; the command says so rather than pretending.)

  The production server installer places a small root-owned launcher at
  `/usr/local/bin/popman`. It invokes the checkout's built manager with the
  exact managed Node executable and exports the install's canonical data and
  workspace paths. This is deliberately not an npm-global package or a symlink:
  a fresh host has no system-wide Node, and custom data paths must not silently
  fall back to `$HOME/.pop-agent`.

The split is not cosmetic: keeping them together would drag
`better-sqlite3` and code that knows where `secret.key` lives onto every
laptop. The good name goes to the everyday tool; the dangerous one reads
like what it is.

**Spec impact:** §17 currently assigns every operator command to `pop`.
It must be rewritten as two CLIs. Nothing in the code refers to those
commands today except the update string in `npm-update-checker.ts`, which
becomes the body of `popman update` (and the Settings → Updates card can
then show `popman update` instead of a four-command incantation).

## The wire

Everything below `/v1` already exists except the local-tools channel.

```
pop                                    server
 │  POST /v1/login { password }          → { token }              (once)
 │  GET  /v1/chats                       → chat list
 │  POST /v1/chats                       → new chat
 │  GET  /v1/chats/:id/messages          → history + live snapshot
 │  POST /v1/chats/:id/messages          → 202 { runId, userMessageId }
 │  POST /v1/events/ticket → GET /v1/events?ticket=…   (SSE, read-only)
 │ ◀━━━━ delta · thinking · tool · done · error · title · run-status
 │  POST /v1/chats/:id/stop
 │
 │  ══ local-tools channel (new, bidirectional) ═══════════════════════════════
 │ ◀──── tool request   { runId, tool, input }
 │ ────▶ tool result    { runId, callId, output | error }
```

- Sending is fire-and-return; the answer arrives on the stream. Same
  contract the PWA uses, so a terminal chat resumes on the phone.
- `GET /messages` already returns a `live` snapshot for a run in flight,
  which is what lets a reattaching client seed its view instead of
  showing a blank bubble.
- Session token renewal rides the existing `x-pop-agent-token` response
  header; the client rewrites its stored token when it sees one.

### Why local access need their own channel

`SseHub` is a `Set` of subscribers with no identity — every event goes to
every connection, by design ("Pop Agent has one user, so every connection sees
everything"). That is right for `delta` and `title`. It is wrong for
"run `rm -rf build/` on your machine", which has **one** addressee: if the
phone has the PWA open, it would receive the request too.

One property is therefore required and does not exist today:
**connection identity** — the client announces itself on connect, and a
tool request is addressed to one connection instead of broadcast. Which
connection that is comes from the message (see Whose local access), so the
channel only has to be able to address it.

Rather than teach the SSE hub identity and risk the PWA's path, the CLI
opens a **second, bidirectional channel** dedicated to local access. SSE stays
the read channel for everyone.

### Precedent: this round trip already exists

`RunService` already suspends a run mid-flight waiting for a client:

1. the agent calls `confirm(question)`
2. the server emits `{kind:'confirm'}` and parks the run on a Promise
3. the client answers `POST /v1/chats/:id/confirm`
4. `resolveConfirm` settles the Promise and the run continues

A tool request is the same shape with a larger payload and a longer wait.
This is a second instance of a tested pattern, not new ground.

## Whose local access

**The sender's** *(decided 04/08)*. A message carries local access of the
machine that typed it, for the whole run it starts. Sent from the
MacBook, the run gets the MacBook's `local_*` tools; sent from the phone,
the run has the server's tools and nothing else; sent from the ThinkPad,
the ThinkPad's. Nothing is attached to the *chat*.

*(Replaces an earlier design where the chat had a local-access **owner** — the
first client to open it — so that a message from the phone would run
`local_bash` on whichever laptop had opened the chat. Two things killed
it. The laptop may simply be off, and a message must never depend on a
machine the sender is not looking at. And it needed a takeover protocol,
a spectator rule, and a story for two terminals racing — machinery for a
question that stops existing when local access follows the message.)*

The rule earns its keep by deleting problems rather than answering them:

- **Two terminals on one chat.** MacBook and ThinkPad, same conversation.
  Each message runs on the machine it was typed on. No conflict to
  resolve, because there was never one pair to fight over.
- **The phone.** It has no local access, so it never has to be told it
  cannot have them; it gets the server's tools, which is what a phone
  session always had.
- **Reading the history back.** The machine is recorded on the message,
  not on the chat, so a `local_bash` from last Tuesday is unambiguous
  even though the terminal that ran it is long gone. This is what makes
  a chat used on two machines legible instead of a guess.
- **A chat with both kinds of message in it.** Nothing hides or replays
  differently: commands run on the MacBook are shown as what they were,
  read later from the phone with no MacBook in sight. Neither the reader
  nor the model needs protecting from that *(decided 04/08)*.
- **Two `pop` on one machine**, different chats, commands at the same
  time. Fine, and not a case worth designing for: same machine, separate
  runs *(decided 04/08)*.
- **Mid-run changes.** There are none to consider. Local access are fixed
  when the message is accepted; attaching or detaching a terminal
  afterwards does not reach into a run already in flight.

The cost is that the agent cannot reach a machine that is not the one
talking to her. Asked from the phone to fix something on the laptop, she
can only say the laptop is not here. That is the honest answer — the
laptop may be in a bag — and the alternative was a message silently
depending on hardware the sender cannot see.

## Guarding two machines

The taint guard (spec §10) refuses a small set of commands in a turn that
read something suspicious from outside. Its list of protected files was
written for the server:

```
secret.key · pi-auth.json · .env · id_rsa · id_ed25519 · authorized_keys · .ssh/
```

On the server that list is exactly right. Pointed at a laptop it is a lock
on the right door of the wrong house. `secret.key` and `pi-auth.json` do
not exist there; meanwhile everything a work machine actually keeps --
`~/.aws/credentials`, `~/.config/gh/hosts.yml`, `.npmrc`,
`.git-credentials`, `~/.kube/config`, the macOS keychain -- is absent from
the list. A laptop's secret surface is far larger than a server
workspace's, and none of it was considered.

**The rule does not change; the list travels with the machine.** *(decided
2026-08-04)* The guard is told where a command is bound for and applies
that target's list:

- **server** — what it protects today, unchanged.
- **local machine** — SSH keys, plus the credential files a developer machine
  carries. Pop Agent's own server files are dropped: they are not there.

The destructive shapes (`rm -rf`, `sudo`, `dd`, pipe-to-shell, fork bomb)
stay refused on both. The attacker in this threat model is a page the
agent read, not the person at the keyboard, and that page is no more
welcome to run `sudo` on the laptop than on the server. None of this is
felt in ordinary use: the guard only exists inside a tainted turn.

## Losing local access

"No timeout while the channel is alive" is the right rule and the easy
half. The hard half is noticing when it stops being alive, because a
closed laptop lid does not close a TCP connection -- it leaves one
standing, dead, for minutes. And a parked run holds the queue slot, so
one sleeping laptop stalls the chat for the phone too.

**Two clocks, and keeping them apart is the whole design** *(decided
2026-08-04)*:

- **The heartbeat** measures the machine. A ping every **15 s**; three
  unanswered (**45 s**) and the server declares local access gone: the
  pending call fails, the run aborts and is persisted as interrupted --
  the same treatment a run already gets when the server restarts
  mid-flight -- and the queue slot is freed.
- **The command** is not measured at all. A twenty-minute `npm install`
  is ordinary, and the laptop answers pings happily while it runs.

The limit is not "this is taking too long". It is "this machine stopped
answering", which is a different question and the only one worth asking.

When the CLI's local-tools WebSocket closes, chat remains available and the CLI
reconnects automatically with exponential backoff from 1 s to 30 s. It says
once that local tools disconnected and are reconnecting, then prints the normal
attached line when they return. A message sent during the gap honestly carries
no local access; after reattach, subsequent messages name the new connection id.
An explicit `/quit` or process shutdown cancels retries.

## Why a WebSocket

*(decided 2026-08-04)* Ping/pong is a WebSocket frame, with a deadline the
server sets -- which is precisely the mechanism the section above needs.
Long-poll + POST would mean building that heartbeat by hand on top.

The `confirm` precedent argues for long-poll and it is a fair argument,
but `confirm` waits seconds for a human; this waits hours for a machine
that may quietly disappear. The failure mode is the deciding factor, not
the happy path.

SSE is untouched: it stays the read channel for the PWA and for every
spectator. The WebSocket exists only for local access, and only the CLI opens it.

## Protocol sketch

**Attach.** The CLI connects, presents its session token, and describes
its machine: hostname, platform, architecture, cwd, client version. The
server checks that version against its minimum and refuses the attach
below it, answering with its own version and the install command so the
client can print something actionable rather than a protocol error (see
Version compatibility). Otherwise it records the connection, and that
record is what a message can later point at. Nothing is claimed at attach
time: connecting a terminal does not change any chat.

**Send.** A message posted by the CLI names its own connection. The
server stores that on the message and the run inherits it; a message from
the PWA names nothing and gets a server-only run. This is the whole of
"whose local access" — one field on the message, decided when it is accepted and
never revisited.

**Tool registration.** When a run's message named a connection, the
server builds pi's coding tools with **remote operations**: the same
`ToolDefinition`s, the same schemas and limits, but the `*Operations`
implementations forward to that connection instead of touching the
server's disk. The agent cannot tell the difference. That connection's
machine description — hostname, platform, architecture, cwd — goes into
the system prompt for this run, so she never suggests `apt install` on a
Mac. When the message named no connection, only the server's set is
registered: the `local_*` tools are absent from the prompt entirely, and
the machine description with them.

**Execution.** Server emits a tool request; the CLI runs it through pi's
**local** operations (`createLocalBashOperations` and friends), prints
output live in the terminal, and posts the final result back. No timeout
while the channel heart-beats.

**Big and unreadable files** *(decided 04/08)*. Two answers, both plain:

- **Over 100 MB**, the client says so and asks before sending. Waiting is
  allowed — it is the maintainer's own network and his own patience.
- **Not text**, the server says it cannot read it. A photo or a zip is
  not a failure to handle, just a file it has nothing to say about.

Nothing streams in chunks and nothing gets clever. The size cap and the
truncation stay on the server with the rest of the rules; the 100 MB
warning is on the client because that is the end that knows before the
bytes move.

**Detach.** When the channel closes — or stops answering pings for 45 s,
which is the same thing arriving late — any pending tool call fails, the
run aborts and is persisted as interrupted, and the queue slot is freed.
That is the same treatment a run gets when the server restarts
mid-flight. The CLI keeps the chat open and reconnects local access in the
background; until reattach, a message names no local access, and afterward it names
the new connection. Nothing else in the chat is affected: a message from the
phone still brings no local access.

**Consequence, stated plainly:** with two sets she can move things
between the machines herself — read on the server, write on the laptop —
and the tool name is the only thing that says which is which. That places
the whole weight on the tool descriptions and on the prompt naming both
machines, which is the cost of the choice.

It also means one turn can touch two machines, so the guard evaluates
each call against the list for the machine it is bound for (see Guarding
two machines). The tool name is what selects the list.

## Client shape

```
pop                      # enter the CLI (TUI)
pop "explain this"       # one-shot: answer, print, exit
pop -p "…"               # same, explicit, for scripts
pop login | logout
pop chats | open <id>
pop update               # launcher repair/reinstall from the selected server, no LLM
pop doctor               # launcher, dependency and server diagnostics
pop --version            # print the installed CLI version offline, then exit
pop --server <profile>   # pick a saved server
```

A bare argument meaning one-shot is what pi and Claude Code do, and what
the hand expects. `-i` was rejected: it reads as *interactive*, the
opposite of the scripting case it was proposed for.

Leaving the interactive screen with `/quit`, `/exit`, or two consecutive Ctrl+C
presses within 500 ms prints the current chat id as a ready-to-paste
`pop --chat <id>` command. The first Ctrl+C clears the editor without exiting;
any other input or an expired interval requires a fresh first press. The farewell
and continuation command are grey so they remain useful without competing with
the transcript. A conversation that has not sent its first message has no server
id yet, so it only says `Bye!`.

**Profiles and preferences.** `~/.config/pop-agent/profiles.json` keeps one
entry per server: URL + token. `preferences.json` is deliberately separate:
it contains device-local presentation choices, never credentials. Login
creates the selected profile; afterwards `pop` just opens.

**Screen.** Thinking is visible by default and rendered dimmed as it streams,
its output live underneath (it is running right there), and the answer
arriving word by word. `/chats` opens the server's canonical unarchived list
(pinned first, then recent) as an inline keyboard picker immediately above the
editor, pushing older transcript lines upward instead of covering them; arrows
move, Enter replaces the visible transcript with the selected chat's latest
history and live snapshot, and Escape cancels without stopping the run. Outside
an open picker, Escape always interrupts the current run and never starts a new
chat. `/new` remains the clean-new-conversation action and replaces the prior
transcript and live state.
`/think` immediately shows or hides reasoning in live and historical assistant
segments, persists that choice for the machine, and reasoning remains visible
after a run settles.
A run-level line stays immediately above the editor:
queued is the static `Waiting for a free slot…`; running is a locally animated
Braille spinner plus `Working…`; settlement removes it. It is deliberately
separate from the growing answer and tool rows, matching the web client and
preventing a completed tool from making a still-active run look idle. pi's
shape, Pop Agent's head.

## Layout

```
cli/
  src/
    application/    session, chat state, StreamEvent reducer
    infrastructure/ api client, event stream, local-access executor, fake api
    interface/tui/  pi-tui components; commands/ for one-shot
    main.ts         composition root
```

Same clean-architecture rules and boundary test as the server. The
`StreamEvent` reducer is a candidate to move into `@pop-agent/shared` and be
shared with the PWA rather than written twice.

Testable without a server through a fake API — the same move Phase 2 made
with `fake-bridge`.

## Order of work

1. API client + session + `pop login` / `pop chats` (proves auth and
   token renewal)
2. Event stream + reducer + `pop "…"` one-shot (proves SSE, dedupe by
   `seq`; no TUI yet)
3. Local-tools channel — **done 04/08**. The WebSocket, the attach with the
   machine's own description, the heartbeat, remote operations
   server-side, and the guard's second list, which landed WITH the channel
   and not after it. pi's tool definitions are registered a second time
   with remote operations (`local_bash`, `local_read`, `local_write`,
   `local_edit`); the terminal end is only a disk and a shell, because
   every rule -- truncation, size caps, error shapes -- stays on the
   server where the definitions are.
4. TUI on top of what already works — **done 04/08**: `pi-tui` as a
   dependency, not a copy. The widgets, the differential renderer, the
   editor with IME, key parsing, markdown-to-ANSI and the keybindings come
   from the library and update with it. What is written here is the
   composition: header, transcript, which slash commands Pop Agent has. pi's own
   screen is not importable (`pi-coding-agent` exports `.` and
   `./rpc-entry`; its CLI is a bundled bin), and copying it would buy
   today's look at the price of every later release.
5. `popman`, and the §17 rewrite
6. Distribution — the bundled pack, the unauthenticated tarball route,
   and the version handshake. Local accesshake is the half that is not
   optional: without it the packaging is a delivery mechanism with
   nothing checking what it delivered

## Security note

From here on, the server can run commands on the laptop. If the server is
compromised, the laptop follows. This is accepted: it is the maintainer's
own server, on his own tailnet, and the client-side blast radius is
already the same as the ssh session he would have opened anyway. The
taint guard stays enabled precisely because the realistic attacker is not
the maintainer but a web page the agent read — which is also why it needs
a list for the laptop before the laptop is reachable at all (see Guarding
two machines).

## Open

- Packaging for a machine that cannot install Node, or cannot reach the
  public registry — the two are usually the same machine. Deliberately
  out of scope until it blocks something; serving the tarball does not
  address it (see Distribution), and Language already names it as the
  thing that would reverse the choice of TypeScript.
- Whether the `StreamEvent` reducer moves to `@pop-agent/shared` (preferred)
  or is written once more for the terminal. No longer a packaging
  question — bundling every `@pop-agent/*` into `dist/` makes either answer
  pack the same. What is left is whether one reducer can serve a DOM and
  a terminal without bending to fit both.
