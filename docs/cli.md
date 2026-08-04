# `popy` — the terminal client, with hands

Design for a new workspace (`cli/`) and the server changes it needs. The
spec stays normative (§17 needs the split described in "Naming" below);
this document explains what the CLI is, what it is *not*, and the one
genuinely new mechanism it introduces: **remote brain, local hands**.

Decisions here came from design conversations on 2026-08-02 and
2026-08-04. Where the maintainer chose between options, that is marked
*(decided)*.

## What it is

`popy` is a chat client for the terminal. A conversation started in the
terminal is an ordinary Popy chat: it appears in the PWA, it enters
memory, it costs from the same budget, it passes the same taint guard, it
gets the same title treatment. Nothing about it is a side channel.

The difference is where the agent's hands are. While a terminal is
attached she has **two pairs**: the system tools she always had, running
on the server, and a second set running **on the machine that typed
`popy`**. Popy's own tools (memory, notes, skills, artifacts,
`web_fetch`) keep running on the server, as always.

*(Revised 04/08. This first said the system tools MOVE to the terminal's
machine while one is attached, and that a `popy` on the MacBook therefore
had no access to the server's files — "hands follow the keyboard". Both
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
(`local_bash`, `local_read`, …) and exists only while one owns the hands.
The system prompt says which machine each is, by hostname and OS.

```
   MacBook / ThinkPad / the server itself          ubuntu-home (or any Popy)
   ┌──────────────────────────────┐                ┌────────────────────────┐
   │ popy (TUI, pi-tui)           │                │  Popy server           │
   │                              │   HTTP + SSE   │   ├ pi SDK (the brain) │
   │  transcript, editor       ───┼───────────────▶│   ├ memory, skills     │
   │  thinking, live output    ◀──┼────────────────┤   ├ taint guard        │
   │                              │                │   ├ cost, history      │
   │  pi's local operations    ◀──┼── hands ch. ──▶│   └ artifacts          │
   │  (bash/read/write/edit)      │                │                        │
   └──────────────────────────────┘                └────────────────────────┘
        the hands                                        the brain
```

**This is not "the CLI runs an agent".** No model runs locally, no
provider key ever reaches the client, no prompt is assembled there. The
client holds one secret: a session token.

## What it is not

- Not a second brain. The alternative — a pi extension running the loop
  locally against Popy's REST API — was considered and rejected: it
  duplicates the head, loses the taint guard, loses `llm_runs` accounting,
  loses multi-provider fallback and layered compaction, and the chat only
  reaches the PWA after the fact.
- Not an operator tool. Service control lives in `popyman` (see Naming).
- Not offline-capable. The server is the truth; there is no local cache.

## Decisions

| Question | Decision |
|---|---|
| Hands opt-in or always? | **Always on**, no flag *(decided)* |
| Does `cwd` matter? | **No.** No trust prompt, no project concept. The whole machine is the ground; the launch directory is only where `bash` starts *(decided)* |
| `popy` run on the server itself? | Same rule, no special case: hands are "the machine that typed", which there happens to be the server *(decided)* |
| Confirmations | **Yolo**: never ask *(decided)* |
| Taint guard | **Stays on, and learns which machine it is guarding.** The threat it answers is injection (a web page telling her to read `~/.ssh/id_rsa`), not the maintainer *(decided)* — see Guarding two machines |
| Hands channel | **WebSocket** *(decided)* — see Why a WebSocket |
| Dead hands | **Heartbeat**, 15 s ping, gone after three unanswered *(decided)* — see Losing the hands |
| Ownership mid-run | **Never changes mid-run.** Open a chat that is already answering and you watch; the hands are yours from the next message *(decided)* |
| Tool behaviour | **Reuse pi's own operations**, not a re-implementation *(decided)* |
| Long commands | No timeout while the hands channel is alive and heart-beating; the run dies when the channel dies *(decided)* |
| Live output | Printed **locally, as it happens**; the server receives the final result. No reverse streaming in v1 *(decided)* |
| Interactive commands (`vim`, `sudo`, `[y/N]`) | Whatever pi's bash tool already does — inherited, not designed *(decided)* |
| Machine awareness | Inject hostname, OS, architecture and cwd into the prompt. Start there, refine later if needed *(decided)* |
| Thinking | Streamed, dimmed, toggleable, remembered per machine *(decided)* |
| Where files land | The existing tool split already answers it: `write`/`edit` touch the local machine (your Obsidian vault, your repo); `save_artifact` produces a server-side artifact visible in Files. The model already chooses between them *(decided)* |
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
2. ~~**`@popy/shared` for compile-time wire coupling.**~~ Real, but
   small: the wire is a handful of REST calls, the `StreamEvent` shapes
   and the hands frames. Another language would hand-write those structs
   and cover them with a contract test. Worth something; not worth a
   language.

**Go was considered and refused (Vinicius, 04/08).** It wins on
distribution, which is the thing this section's open question is about:
one static binary of ~10 MB, no runtime, `scp` it anywhere. Against that
is the TUI — roughly 350 lines of screen composition that today ride on
pi-tui and would become a project of their own, maintained by hand and
no longer improving when pi does.

The asymmetry decided it. The gain is **once** (install Node), the cost
is **forever** (own a TUI, and forgo every later pi release). Trading a
one-time annoyance for a permanent one is a bad trade.

**What would reverse it**, stated so it is recognised when it arrives:
the day `popy` has to run somewhere Node cannot be installed — handed to
someone who is not a developer, or a machine under corporate policy. Then
"install Node first" stops being a convenience of the maintainer's and
becomes a wall, and Go earns it.

## Distribution

**The server serves its own client** *(Vinicius, 04/08; evaluated, not yet
built)*:

```
npm i -g https://your-popy.example/cli-0.2.0.tgz
```

Chosen over publishing to the public registry because for self-hosted
software it is the right shape: **the thing you run hands you the thing
you talk to it with.** The install line carries its own address, which a
README cannot get wrong, and what it hands you is that server's own
version, not whatever the registry's `latest` happens to be.

*(Corrected 04/08. This first said the reason was that "the client cannot
drift from the server it talks to". That is only true on the day of the
install. The server moves to 0.3 and the laptop keeps the 0.2 it was
handed — the same mismatch, arrived at from the other side. Serving the
tarball is still the right choice; it just is not what stops drift. That
is the next section, and it has to exist either way.)*

### Version compatibility

The two ends share a wire — REST, the `StreamEvent` shapes, the hands
frames — and a mismatched pair fails in a way nobody can read. Nothing
about *where the client came from* prevents that; only the handshake
does. Attach already carries the client version (see Protocol sketch);
the server has to read it.

**The server holds two numbers** *(decided 04/08)*: its own version, and
the oldest client it still accepts. The second is set by hand and moves
rarely — only when the wire changes in a way an older client cannot
survive. Most releases do not touch it.

| Client vs. minimum | What happens |
|---|---|
| At or above | **Nothing.** No banner, no prompt. |
| Below the current version, at or above the minimum | **One dim line**, once per new version: `popy 0.2.0 · server 0.3.0 · update: npm i -g https://…/cli-0.3.0.tgz` |
| Below the minimum | **Refuses to attach.** Prints the exact install command and offers to run it: `Install now? [Y/n]` |

The asymmetry is the point. In the optional case a prompt would be
answered `n` on reflex and would train the reflex; a line that scrolls
past costs nothing and is still there when wanted. In the blocking case
the client is not usable anyway, so asking is not an interruption — it is
the way forward, and the one moment where installing on the user's behalf
is not a surprise. Nothing auto-updates silently, and nothing tries to
replace a running process mid-session.

**Knowing when to raise the minimum** is a judgement, not a detection.
The wire lives in few places — the `/v1` routes, the `StreamEvent`
shapes, the hands frames. A commit that touches one of them is the cue to
ask whether the previous client survives it. A test that fails when those
files change without the number changing is worth having as a prod; it
cannot make the call.

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
-w @popy/cli` produces a 49 KB tarball that does not install:

```
npm error 404 '@popy/shared@*' is not in this registry
```

`@popy/shared` is a workspace dependency; outside the monorepo npm looks
for it on the public registry and finds nothing.

**The rule that fixes it, stated generally**: the build bundles every
`@popy/*` import into the CLI's own `dist/`, and leaves `pi-tui`, `ws`
and `marked` external. The published `package.json` then lists three
public dependencies and no workspace ones, and packing works regardless
of how much of `shared` the CLI grows into.

Today that is three string constants and inlining them by hand would do.
Stating it as a rule instead costs nothing now and settles the question
left Open below: if the `StreamEvent` reducer moves into `@popy/shared`
to stop being written twice, packaging does not notice. Sized for the
small case, the rule would have had to be redone for the large one.

This is a partial bundle, and it belongs in the comparison below: it
keeps `popy` a command on the PATH, unlike the full bundle, and keeps the
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
`node_modules` at all — but it is `node popy.mjs`, not a command on the
PATH, and it must be ESM **with a `createRequire` banner**, because plain
ESM dies on a dynamic `require` inside a dependency and plain CJS dies on
`import.meta`. A Go binary would be ~10 MB and need no runtime; see
Language for why that is not the trade being made. A Node SEA is ~120 MB,
because it carries the whole Node binary, and needs codesigning to
cross-build for macOS.


## Naming

- **`popy`** — the client. New workspace `cli/`, package `@popy/cli`,
  installable anywhere. *(Correction, 04/08: this said "no native
  dependencies". `pi-tui` ships prebuilt `.node` binaries for macOS and
  Windows -- `darwin-modifiers`, `win32-console-mode` -- so the claim was
  wrong. They are prebuilds, not a compile step, and Linux has none and
  degrades without them, so nothing about installability changes; but the
  sentence that the packaging question rests on has to be true.)*
- **`popyman`** — the manager: `start | stop | restart` of the Popy
  service, plus the operator surface the spec already lists
  (`backup | restore | update | reset-password | access-list`). Ships with
  the server, runs only there, touches SQLite, `secret.key` and systemd.

The split is not cosmetic: keeping them together would drag
`better-sqlite3` and code that knows where `secret.key` lives onto every
laptop. The good name goes to the everyday tool; the dangerous one reads
like what it is.

**Spec impact:** §17 currently assigns every operator command to `popy`.
It must be rewritten as two CLIs. Nothing in the code refers to those
commands today except the update string in `npm-update-checker.ts`, which
becomes the body of `popyman update` (and the Settings → Updates card can
then show `popyman update` instead of a four-command incantation).

## The wire

Everything below `/v1` already exists except the hands channel.

```
popy                                    server
 │  POST /v1/login { password }          → { token }              (once)
 │  GET  /v1/chats                       → chat list
 │  POST /v1/chats                       → new chat
 │  GET  /v1/chats/:id/messages          → history + live snapshot
 │  POST /v1/chats/:id/messages          → 202 { runId, userMessageId }
 │  POST /v1/events/ticket → GET /v1/events?ticket=…   (SSE, read-only)
 │ ◀━━━━ delta · thinking · tool · done · error · title · run-status
 │  POST /v1/chats/:id/stop
 │
 │  ══ hands channel (new, bidirectional) ═══════════════════════════════
 │ ◀──── tool request   { runId, tool, input }
 │ ────▶ tool result    { runId, callId, output | error }
```

- Sending is fire-and-return; the answer arrives on the stream. Same
  contract the PWA uses, so a terminal chat resumes on the phone.
- `GET /messages` already returns a `live` snapshot for a run in flight,
  which is what lets a reattaching client seed its view instead of
  showing a blank bubble.
- Session token renewal rides the existing `x-popy-token` response
  header; the client rewrites its stored token when it sees one.

### Why the hands need their own channel

`SseHub` is a `Set` of subscribers with no identity — every event goes to
every connection, by design ("Popy has one user, so every connection sees
everything"). That is right for `delta` and `title`. It is wrong for
"run `rm -rf build/` on your machine", which has **one** addressee: if the
phone has the PWA open, it would receive the request too.

Two properties are therefore required and do not exist today:

1. **Connection identity** — the client announces itself on connect.
2. **Hand ownership** — a chat records *which* connection is its hands.
   Only that connection receives tool requests. A second terminal on the
   same chat is a spectator unless it explicitly takes over; someone must
   own the hands, or two machines run `npm install` at once.

Rather than teach the SSE hub identity and risk the PWA's path, the CLI
opens a **second, bidirectional channel** dedicated to hands. SSE stays
the read channel for everyone.

### Precedent: this round trip already exists

`RunService` already suspends a run mid-flight waiting for a client:

1. the agent calls `confirm(question)`
2. the server emits `{kind:'confirm'}` and parks the run on a Promise
3. the client answers `POST /v1/chats/:id/confirm`
4. `resolveConfirm` settles the Promise and the run continues

A tool request is the same shape with a larger payload and a longer wait.
This is a second instance of a tested pattern, not new ground.

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
- **hands** — SSH keys, plus the credential files a developer machine
  carries. Popy's own server files are dropped: they are not there.

The destructive shapes (`rm -rf`, `sudo`, `dd`, pipe-to-shell, fork bomb)
stay refused on both. The attacker in this threat model is a page the
agent read, not the person at the keyboard, and that page is no more
welcome to run `sudo` on the laptop than on the server. None of this is
felt in ordinary use: the guard only exists inside a tainted turn.

## Losing the hands

"No timeout while the channel is alive" is the right rule and the easy
half. The hard half is noticing when it stops being alive, because a
closed laptop lid does not close a TCP connection -- it leaves one
standing, dead, for minutes. And a parked run holds the queue slot, so
one sleeping laptop stalls the chat for the phone too.

**Two clocks, and keeping them apart is the whole design** *(decided
2026-08-04)*:

- **The heartbeat** measures the machine. A ping every **15 s**; three
  unanswered (**45 s**) and the server declares the hands gone: the
  pending call fails, the run aborts and is persisted as interrupted --
  the same treatment a run already gets when the server restarts
  mid-flight -- and the queue slot is freed.
- **The command** is not measured at all. A twenty-minute `npm install`
  is ordinary, and the laptop answers pings happily while it runs.

The limit is not "this is taking too long". It is "this machine stopped
answering", which is a different question and the only one worth asking.

## Why a WebSocket

*(decided 2026-08-04)* Ping/pong is a WebSocket frame, with a deadline the
server sets -- which is precisely the mechanism the section above needs.
Long-poll + POST would mean building that heartbeat by hand on top.

The `confirm` precedent argues for long-poll and it is a fair argument,
but `confirm` waits seconds for a human; this waits hours for a machine
that may quietly disappear. The failure mode is the deciding factor, not
the happy path.

SSE is untouched: it stays the read channel for the PWA and for every
spectator. The WebSocket exists only for hands, and only the CLI opens it.

## Protocol sketch

**Attach.** The CLI connects, presents its session token, and describes
its machine: hostname, platform, architecture, cwd, client version. The
server checks that version against its minimum and refuses the attach
below it, answering with its own version and the install command so the
client can print something actionable rather than a protocol error (see
Version compatibility). Otherwise it records the connection and — for
chats this client creates or opens — marks it as the hands owner. The
machine description is injected into the system prompt so she never
suggests `apt install` on a Mac.

**Tool registration.** When a run belongs to a chat with hands attached,
the server builds pi's coding tools with **remote operations**: the same
`ToolDefinition`s, the same schemas and limits, but the `*Operations`
implementations forward to the owning connection instead of touching the
server's disk. The agent cannot tell the difference.

**Execution.** Server emits a tool request; the CLI runs it through pi's
**local** operations (`createLocalBashOperations` and friends), prints
output live in the terminal, and posts the final result back. No timeout
while the channel heart-beats.

**Detach.** When the channel closes — or stops answering pings for 45 s,
which is the same thing arriving late — any pending tool call fails, the
run aborts and is persisted as interrupted, and the queue slot is freed.
That is the same treatment a run gets when the server restarts
mid-flight. Reopening the chat in the PWA is
fine; the system tools are simply **absent from the prompt**, and she can
say she no longer has access to that machine.

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
popy                      # enter the CLI (TUI)
popy "explain this"       # one-shot: answer, print, exit
popy -p "…"               # same, explicit, for scripts
popy login | logout
popy chats | open <id>
popy --server <profile>   # pick a saved server
```

A bare argument meaning one-shot is what pi and Claude Code do, and what
the hand expects. `-i` was rejected: it reads as *interactive*, the
opposite of the scripting case it was proposed for.

**Profiles.** `~/.config/popy/` keeps one entry per server: URL + token.
`localhost:8787` on the server, the `*.ts.net` name from a laptop. Login
creates the entry; afterwards `popy` just opens.

**Screen.** Thinking dimmed as it streams, the chosen command highlighted,
its output live underneath (it is running right there), and the answer
arriving word by word. pi's shape, Popy's head.

## Layout

```
cli/
  src/
    application/    session, chat state, StreamEvent reducer
    infrastructure/ api client, event stream, hands executor, fake api
    interface/tui/  pi-tui components; commands/ for one-shot
    main.ts         composition root
```

Same clean-architecture rules and boundary test as the server. The
`StreamEvent` reducer is a candidate to move into `@popy/shared` and be
shared with the PWA rather than written twice.

Testable without a server through a fake API — the same move Phase 2 made
with `fake-bridge`.

## Order of work

1. API client + session + `popy login` / `popy chats` (proves auth and
   token renewal)
2. Event stream + reducer + `popy "…"` one-shot (proves SSE, dedupe by
   `seq`; no TUI yet)
3. Hands channel — **done 04/08**. The WebSocket, the attach with the
   machine's own description, ownership, the heartbeat, remote operations
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
   composition: header, transcript, which slash commands Popy has. pi's own
   screen is not importable (`pi-coding-agent` exports `.` and
   `./rpc-entry`; its CLI is a bundled bin), and copying it would buy
   today's look at the price of every later release.
5. `popyman`, and the §17 rewrite
6. Distribution — the bundled pack, the unauthenticated tarball route,
   and the version handshake. The handshake is the half that is not
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
- Whether the `StreamEvent` reducer moves to `@popy/shared` (preferred)
  or is written once more for the terminal. No longer a packaging
  question — bundling every `@popy/*` into `dist/` makes either answer
  pack the same. What is left is whether one reducer can serve a DOM and
  a terminal without bending to fit both.
