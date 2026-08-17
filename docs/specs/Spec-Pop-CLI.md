# Pop Agent — CLI and operator CLI

**Status:** normative
**Legacy coverage:** §17
**Primary implementation:** launcher, cli, server/src/manager
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
## 17. Two CLIs

Not one command with a mode: `pop` and `popman` are separate programs
with separate audiences, and the split is what keeps the everyday one
installable. Full design in `docs/cli.md`.

**`pop`** — a native Go launcher in front of the TypeScript chat client. The
server's no-store `/install.sh` and `/install.ps1` select and SHA-256-check a
precompiled launcher; users never install Go. On first run it asks for the
server origin when none exists. Public `/cli/manifest.json` names the latest
immutable packed `cli-X.Y.Z.tgz`, its size/hash, minimum Node and minimum launcher.
That packed release may briefly trail the server version; protocol negotiation
remains the authority on compatibility, so a version bump cannot turn first
install into a 404 before new artifacts are packed.
The launcher installs privately and atomically rather than through global npm,
then execs the active Node CLI. The legacy no-store `/cli-latest.tgz` redirect
remains for migration. The client carries no server code: no `better-sqlite3`,
no `argon2`, nothing that knows where `secret.key` lives. It also carries **Pop
Local Access (PLA)**, an internal library used by the interactive CLI. PLA never
creates a chat or invokes an LLM. The installed PWA and local access are separate:
the browser owns the PWA, while the optional Pop Local Access tray owns its own
lifecycle without introducing a native WebView wrapper. The tray is a minimal
native host in `local-access/tray`: it supervises the TypeScript PLA runtime from
the CLI, exposes a server-synchronized per-computer file-access switch plus
reconnect/start-at-login controls and opens the PWA, but contains no WebView,
chat UI, agent loop or local-tools protocol.

PLA opens authenticated WSS `/v1/local-tools`; after two pre-attach upgrade
failures with ordinary authenticated HTTPS still healthy, it falls back to
the long-poll `/v1/local-tools/connections/*` transport. Both use the same
Bearer session, application frames, limits, heartbeat, cancellation and
connection id. An attached WSS connection requires inbound server traffic
within the 45-second local lease; silence terminates the socket and reconnects,
so a proxy cannot leave a client attached to a stream the restarted server no
longer owns.

An interactive message explicitly names its PLA connection. Browser and PWA
messages never inherit a background machine implicitly: they must explicitly
select a live connection once the optional PLA UI exists. Otherwise the run
honestly receives no local tools. An explicit dead id is rejected
before a run starts and never falls back to another machine. Disconnects fail
pending calls and never replay non-idempotent work. Logout, password recovery,
epoch change and token expiry close attached local access.

    pop | pop "question" | pop -p "…"
    pop login | logout | servers | chats | update | doctor
    pop --chat <id>
    pop --version | --launcher-version

Leaving the interactive client through Ctrl+C, `/quit` or `/exit` prints
`Bye!` and, when the conversation has a server id, a ready-to-paste
`pop --chat <id>` continuation command. The whole farewell block is grey.
Before the first message creates the chat, only `Bye!` is printed.

`pop --version` is entirely offline: the launcher reads only its atomic local
state, finds Node and execs the active CLI's side-effect-free version path. It
does not read a profile, open PLA, contact a server or create a chat.
`--launcher-version` needs neither Node nor an installed CLI.

Local execution notices (`ran here: …`) belong to the live assistant segment,
after its tool statuses and before its prose. They are never appended as later
transcript rows: doing that leaves a finished answer above a long tail of local
commands and makes the response hard to read, especially in Windows Terminal.

A machine can bootstrap the native launcher from its own server without
already having Node, npm or knowing the current CLI version:

    curl -fsSL https://<server>/install.sh | sh
    powershell -c "irm https://<server>/install.ps1 | iex"

The public no-store scripts derive `<server>` from their request origin, select
a precompiled OS/architecture artifact, verify its embedded SHA-256 and add its
user-owned directory to PATH. They carry no session, credential or user data.
The launcher subsequently diagnoses Node `>=22.19.0` and npm; on Windows it
executes npm's JavaScript entrypoint through `node.exe`, never a shell or a
`.cmd` wrapper.

**`popman`** — the operator's tool. Ships with the server, runs only
there, and is the only thing that touches systemd, the SQLite file and
the backups directory.

    popman start | stop | restart | status
    popman backup | backups | restore <name>
    popman reset-password
    popman update

`reset-password` covers "forgot the password AND the recovery key" for
whoever has shell: no proof is asked for, because owning the machine is
already the proof, which is also why it exists nowhere else — an HTTP
route with the same power would be a password reset for anyone who found
the URL. It bumps the session epoch, so every signed-in device is signed
out, and prints a new recovery key once.

`access-list` is named in §18 and **not built**: there is no IP access
list to manage yet. `popman access-list` says so rather than pretending.

**Client/server versions.** Root `VERSION` is the single manually edited global
release version. A TypeScript consistency check runs before typecheck, build and
the full gate; it rejects drift in package manifests, lockfile workspace entries,
the CLI handshake and packed CLI metadata. The PWA is part of the server build
and follows the service-worker update channel; there is no independently
versioned native Desktop package.

The server holds its own version and the
oldest client it accepts; the local-tools attach compares them.
Compatible is silent, merely behind prints one line with the install
command, and below the minimum is refused with that command. The minimum
is set by hand and moves only when the wire changes.

## Detailed design

See [../cli.md](../cli.md).
