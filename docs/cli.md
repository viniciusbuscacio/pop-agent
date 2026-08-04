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
attached, the **system tools** (`bash`, `read`, `write`, `edit`, and the
rest of pi's coding tools) execute **on the machine that typed `popy`** —
not in `POPY_DATA_DIR`'s workspace. Popy's own tools (memory, notes,
skills, artifacts, `web_fetch`) keep running on the server, as always.

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

## Language

TypeScript, as a fourth workspace in the monorepo, inside the same gate.
Three pieces the CLI depends on exist only in JS/TS, and each one is the
direct consequence of a decision above:

1. **pi's local operations.** pi exports `createLocalBashOperations`,
   `createBashTool`, `createReadTool`, `createEditTool`,
   `createWriteTool`, plus the `BashOperations` / `ReadOperations` /
   `EditOperations` / `WriteOperations` interfaces and the truncation
   helpers. The library deliberately separates *what a tool is* from
   *what touches the disk* — which is exactly the seam this design needs
   (see Protocol). Any other language means re-implementing output
   truncation, file size caps, stdin handling and error shapes by hand,
   and watching them drift from the server on the next pi release.
2. **`@earendil-works/pi-tui`**, published standalone at pi's own
   version: differential rendering, `Editor` with IME support,
   `Container`, autocomplete, ANSI-aware wrapping. "Looks like pi"
   becomes a dependency instead of a project.
3. **`@popy/shared`**, so the compiler breaks the CLI when the wire
   changes — the rule that has kept the PWA from drifting (spec §3, §13).

Distribution to a machine without npm is a packaging question, resolved
when it comes up; it does not affect the design.

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
server records the connection and — for chats this client creates or
opens — marks it as the hands owner. The machine description is injected
into the system prompt so she never suggests `apt install` on a Mac.

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

**Consequence, stated plainly:** a `popy` open on the MacBook has no
direct access to the server's files. To touch `~/dev/popy`, open `popy`
there over ssh — hands follow the keyboard. (Or let her use `ssh`
herself; both machines are on the same tailnet. That is her choice, not
architecture.)

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
3. Hands channel: the WebSocket, identity, ownership (never mid-run), the
   heartbeat, remote operations server-side, pi's local operations
   client-side, and the guard's second list — the laptop is unprotected
   until that list exists, so it lands with the channel, not after it
4. TUI on top of what already works — **done 04/08**: `pi-tui` as a
   dependency, not a copy. The widgets, the differential renderer, the
   editor with IME, key parsing, markdown-to-ANSI and the keybindings come
   from the library and update with it. What is written here is the
   composition: header, transcript, which slash commands Popy has. pi's own
   screen is not importable (`pi-coding-agent` exports `.` and
   `./rpc-entry`; its CLI is a bundled bin), and copying it would buy
   today's look at the price of every later release.
5. `popyman`, and the §17 rewrite

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

- Packaging for a machine without npm (a Mac under corporate policy) —
  deliberately out of scope until it blocks something.
- Whether the `StreamEvent` reducer moves to `@popy/shared` (preferred)
  or is written once more for the terminal.
