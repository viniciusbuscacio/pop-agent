# Pop Agent

**Your personal AI agent, running on your own server.**

Chat from your browser, phone, or terminal. Work with files, automate tasks,
connect tools, and talk to other agents — with one conversation history across
all your devices.

![Pop Agent PWA on Windows in dark mode, with Chat, Files, and Agent navigation](docs/images/pop-agent-desktop.png)

[Install](#install) · [Features](#what-you-can-do) · [Documentation](#documentation) · [Contributing](CONTRIBUTING.md)

Pop Agent is built for one person and their own server. It is used daily by its
creator and is currently **beta (pre-1.0)**.

## What you can do

- **Continue across devices.** Use the responsive web app, install it as a PWA
  on desktop or mobile, or open the `pop` terminal client. Conversations and
  their history stay on the server.
- **Choose your model.** Connect supported API or subscription providers,
  select a model per conversation, and configure provider failover.
- **Give the agent tools.** Work with server files and commands, connect MCP
  servers, add reusable Skills, and schedule tasks.
- **Connect your computer.** Optional Pop Local Access lets the agent use files
  and tools on a selected Windows or macOS computer.
- **Manage files in the app.** Upload files or entire folders, edit plain text,
  preview images, HTML, and PDFs, and recover deleted files from the trash.
- **Use voice and memory.** Transcribe voice notes on your server, search past
  conversations, and maintain personal memory and Notes.
- **Connect other software and agents.** REST API Server and Client support
  integrations. A2A Server and Client exchange text requests and results with
  remote agents, with labels distinguishing owner and agent submissions.

### On iPhone

The conversation list and chat view adapt to the smaller screen.

<p>
  <img src="docs/images/pop-agent-iphone-conversations.jpeg" alt="Pop Agent on iPhone showing the conversation list and Chat, Files, and Agent navigation" width="240" />
  <img src="docs/images/pop-agent-iphone-chat.jpeg" alt="Pop Agent on iPhone showing a new chat and the message composer" width="240" />
</p>

## Built on pi

Pop Agent uses **pi agent** (`@earendil-works/pi-coding-agent`) as its execution
engine, including session handling and context compaction. Pop adds the personal
server experience: authentication, web and terminal interfaces, persistent data,
provider configuration, integrations, and access across devices.

The application is a TypeScript monorepo with a React frontend and SQLite
storage. Small Go programs provide the client launcher and Local Access tray.
See the [architecture and specification index](docs/specs/Spec-Pop-General.md).

## Your server, your data

Conversations, files, memory, and encrypted provider credentials live on your
server. Pop Agent has no telemetry and is permanently single-user.

Self-hosting does not make the language model local: requests and relevant
context are sent to your selected provider. Connected tools and integrations
may also exchange data with their configured services.

Remote access uses private HTTPS through Tailscale. REST API and A2A servers
start disabled on fresh installations; each has its own access key and IP
allowlist. Incoming A2A requests can invoke the tools available to your agent.

## Install

You need:

- **Ubuntu 24.04 or newer**, with systemd, on **amd64 / x86-64**;
- a non-root account with `sudo`, Git, and outbound internet access;
- Tailscale on the device you will use to access Pop;
- a supported model provider account or API key.

Run on the Ubuntu server:

```sh
git clone --depth 1 https://github.com/viniciusbuscacio/pop-agent.git
cd pop-agent
./deploy/bootstrap-server.sh --install-apt-packages
```

If the repository is private, complete the
[GitHub authentication steps](deploy/README.md#private-repositories) before cloning.

The installer downloads a verified prebuilt release and the managed Node and
Whisper runtimes, installs missing prerequisites and Tailscale, and starts the
service. An audio-only FFmpeg binary is included. Normal installation does not
compile the project or run the full development test suite.

Installation shows concise progress. Press **D** for detailed output; the full
installation log path is printed for troubleshooting.

### Finish in your browser

1. Open the private-LAN setup URL printed by the installer and enter its
   one-time code.
2. Connect the server to Tailscale. Keep your browser device on the same tailnet.
3. Follow the setup flow to the private HTTPS address, create your password,
   and save the recovery key.
4. Connect a model provider and start a conversation.
5. Optionally install the PWA and CLI from **Settings → Installation**.

The setup code lasts 15 minutes. Generate another on the server with:

```sh
popman onboarding-code
```

The app listens on `127.0.0.1:8787` behind Tailscale Serve. The temporary setup
page uses `http://<private-LAN-IP>:8788/setup`; passwords are created only after
moving to HTTPS. Do **not** expose port 8787 directly.

Data defaults to `~/.pop-agent`, and the agent workspace to
`~/pop-agent-workspace`. Create a backup after setup and protect `secret.key`
separately: it is intentionally excluded from backup archives.

For custom paths, network setup, logs, and installation recovery, see the
[deployment guide](deploy/README.md).

## Current limits

- The supported server distribution is Ubuntu amd64. There is no packaged
  Windows server, Docker distribution, or ARM64 release.
- Each installation has one owner. Multi-user accounts and hosted cloud sync
  are outside the project scope.
- Model subscriptions, API charges, and provider availability are separate
  from Pop Agent.
- Files uploads allow 100 MiB per file. Chat supports up to eight attachments,
  25 MiB each and 100 MiB combined; voice notes are limited to 25 MiB.
- A2A Server currently supports text tasks without protocol streaming, file
  exchange, or push notifications. Continuing a completed A2A conversation is
  supported by the server protocol but is not yet exposed by the client UI;
  its Continue action handles tasks waiting for more input.
- Beta updates can include compatibility changes. Read the
  [changelog](CHANGELOG.md) and keep backups. See the [support policy](SUPPORT.md).

## Development

Development requires Node.js `>=22.19.0`, npm, Go `>=1.23`, Git, and the native
build tools required by the locked dependencies.

```sh
npm ci
npm run build
dev_root=$(mktemp -d)
POP_AGENT_DATA_DIR="$dev_root/data" \
  POP_AGENT_WORKSPACE="$dev_root/workspace" \
  npm run dev
```

For live frontend development, use a second terminal:

```sh
npm run dev -w @pop-agent/web
```

The full validation gate runs locally before a release batch is published:

```sh
npm run gate
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making a change. Report reproducible
bugs through GitHub Issues; report vulnerabilities privately using
[SECURITY.md](SECURITY.md).

## Documentation

- [Installation and deployment](deploy/README.md)
- [CLI and Pop Local Access](docs/cli.md)
- [MCP compatibility](docs/mcp.md)
- [REST API Server and Client](docs/specs/Spec-Pop-REST-API.md)
- [A2A Server and Client](docs/specs/Spec-Pop-A2A.md)
- [Security model](docs/specs/Spec-Pop-Security.md)
- [Architecture and specification index](docs/specs/Spec-Pop-General.md)
- [Updates and distribution](docs/specs/Spec-Pop-Installation.md)
- [Maintainer release guide](docs/RELEASING.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

[MIT](LICENSE) © 2026 Vinicius Buscacio.
