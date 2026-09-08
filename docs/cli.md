# Pop CLI and Local Access guide

`pop` is the terminal client for your Pop Agent server. Conversations, model
execution, provider credentials, memory and durable history stay on the server.
The CLI uses pi-tui for rendering; it does not run a separate agent.

This is a usage guide for the current implementation. The normative contracts
are [CLI](specs/Spec-Pop-CLI.md),
[installation and updates](specs/Spec-Pop-Installation.md), and
[Local Access](specs/Spec-Pop-Local-Access.md). Earlier design decisions remain
in Git history.

## Install and sign in

Open Settings → Installation on your server and use the command for your
computer. The server supplies the native launcher, versioned CLI and supported
managed Node packages. The Windows PLA installer also prepares managed Node.
You do not need the Go toolchain to install a client.

Sign in to your own server origin:

```sh
pop login https://your-server.example
```

Enter the password at the hidden prompt. A successful interactive login opens
chat immediately. Use `pop login https://your-server.example --no-chat` when
you only want to save the session. Remote origins require HTTPS; loopback HTTP
is allowed for development.

Profiles store the server origin and session token, never provider keys. Use
`pop servers` to list saved profiles and `pop logout` to remove the selected
token. An expired or revoked session requires another login.

## Commands

| Command | Purpose |
|---|---|
| `pop` | Open interactive chat |
| `pop "question"` or `pop -p "question"` | Send a one-shot question, print the answer and exit |
| `pop --chat <id>` | Continue an existing conversation |
| `pop chats` | List conversations |
| `pop --server <name>` | Use a saved profile instead of the default |
| `pop update` | Check and update the launcher and CLI |
| `pop update --repair` | Reinstall the advertised CLI, subject to the no-downgrade rule |
| `pop version` | Print the installed CLI version without network access |
| `pop --launcher-version` | Print the native launcher version |
| `pop runtime doctor` | Inspect the local Node runtime |
| `pop runtime install --server https://your-server.example` | Prepare managed Node from the server |
| `pop local-access` | Keep the local-access connection running in the foreground |
| `pop --help` | Show command-line help |

The continuation command printed on exit contains the persistent chat ID. An
empty conversation may have no ID yet. Resuming an unknown ID reports an error
instead of creating a replacement conversation.

## Updates

The installed `pop` command has two parts: a native launcher and a TypeScript
CLI. They have separate version numbers. A bare launch and `--chat` continuation
check the server's published launcher and CLI releases before opening chat.
Equal versions do not reinstall; `--repair` is explicit. Downloads are checked
before activation, and a failed candidate preserves the previous active CLI.
A newer compatible local CLI is not silently downgraded.

`pop update` updates the client components; it does not update the server.
Use the server's update interface or `popman update` on the server for that.
The server publishes client artifacts and minimum compatible versions, so the
server version alone is not proof that a matching client package is available.
See the [deployment guide](../deploy/README.md) for packing and activation.

## Interactive chat

| Command | Purpose |
|---|---|
| `/new` | Start a fresh conversation |
| `/chats` | Open the conversation picker |
| `/model` | Open the searchable provider/model picker |
| `/model <provider-id> <model-id>` | Select an explicit pair for this chat |
| `/model default` | Return this chat to the server default |
| `/stop` | Interrupt the active answer |
| `/think` | Toggle visible reasoning |
| `/session` | Show pi session statistics |
| `/compact` | Request native pi compaction |
| `/name` | Rename the chat and pi session |
| `/export` | Export the pi session to Files |
| `/fork` | Fork from an earlier user message |
| `/archive` | Archive the current idle chat |
| `/unarchive` | Restore the selected archived chat |
| `/help` | Show command help |
| `/quit` | Exit; `/exit` is also accepted |

In a picker, type to filter, use arrows to navigate, Enter to select and Escape
to cancel. Outside a picker, Escape interrupts the active run. The first Ctrl+C
clears the editor; a second consecutive press within 500 ms exits.

Model selection always identifies both provider and model. Model IDs containing
`/` remain one argument. The picker shows configured, enabled providers and
puts recent pairs first. A stored pair missing from current catalogs remains
visible as unavailable.

The selection belongs to the conversation. Opening or cancelling the picker on
a fresh screen creates nothing. Choosing an explicit pair can create the chat;
the first dependent message waits for the model change to succeed. A failed
change preserves the draft. `/new` returns to Default, and changes from another
client synchronize into the open chat.

Changing model does not interrupt an admitted run or change its model. A
follow-up still waiting in the chat's durable queue uses the pair selected when
that follow-up starts. Steering into an existing run uses that run's pair.

Compaction follows pi's native behavior and defaults. `Nothing to compact
(session too small)` is a native refusal, not a reason to force a custom Pop
threshold. `/session` helps inspect the session before requesting compaction.

An archived chat remains visible but read-only. `/unarchive` restores it; a
failed archive or restore keeps the current transcript and draft.

## Local Access

Pop Local Access (PLA) lends a selected computer's file and shell operations to
the server. It has no agent loop. Server tools retain names such as `read` and
`bash`; selected-computer tools use `local_read` and `local_bash`.

Local access depends on both server permission and a live connection. A saved
machine name is not proof that the computer is online. The CLI reports its
attachment status, and the PWA lets you select a local machine. Requests that
require an unavailable selected machine must not silently run on another
computer. Server-only conversation remains available without PLA.

For background desktop use, install Pop Local Access from Settings →
Installation. Windows installation creates a Start menu shortcut with the Pop
icon. The tray supervises the local runtime; quitting it closes its child
processes. An independently running CLI can still provide a separate local
connection, so check active clients when diagnosing availability.

Local tool definitions reuse pi's tools through remote operations. Pop owns
machine selection, permissions and transport, while the agent runtime remains
on the server. Details are in the
[Local Access specification](specs/Spec-Pop-Local-Access.md).

## Troubleshooting

- **Session expired or revoked:** run the login command shown in the error.
- **Unknown slash command after a server update:** check `pop version` and run
  `pop update`. Confirm the server has packed its client artifacts.
- **Missing or damaged CLI installation:** run `pop update --repair`.
- **Missing Node:** run `pop runtime doctor`, then the runtime install command
  for your server. Keep any reported download/version failure for diagnosis.
- **Selected computer offline:** start PLA on that computer and check permission
  and connection status, or select server-only operation in the PWA.
- **Connection interrupted:** resume with the printed `pop --chat <id>` command.
  Authentication errors require login rather than repeated reconnect attempts.

## Server administration

`popman` is installed on the Ubuntu server. It handles service control, backups,
restore, account recovery and server updates. It is separate from the client:

```text
popman status
popman restart
popman backup
popman backups
popman update
popman onboarding-code
```

See the [operations specification](specs/Spec-Pop-Deployment-and-Operations.md)
for restore, recovery and update procedures.

## Layout

The CLI source lives under `cli/src`: `application` owns session behavior,
`infrastructure` owns HTTP, streams, profiles and local execution, and
`interface` owns commands and the TUI. `main.ts` composes these adapters.
`launcher/` contains the native bootstrap/update executable. Shared wire DTOs
live in `shared/`.

### Encrypted backups

Set and confirm an independent backup password in Settings → Backup. Pop stores
it encrypted for future `popman backup` invocations, including operator-scheduled
ones. New files use `.popbackup`; older `.tar.gz` files remain unencrypted.

`popman restore <exact-name>` prompts for the password used to create an encrypted
archive, without echoing it. Save it outside Pop. Changing the saved password
affects only new backups. Restore on another host recovers content, but without
the original host key, SecretsRepo integration credentials must be re-entered.
