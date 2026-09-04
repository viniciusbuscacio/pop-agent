# Pop Agent

**A personal, self-hosted agent that keeps conversations in sync across web,
installed PWA, and terminal clients, connects to multiple LLM providers, and
keeps your data under your control.**

> [!IMPORTANT]
> Pop Agent is a **public beta** and remains pre-1.0. It is a working personal
> system and an AI engineering portfolio project, not a hosted service. Expect
> intentional compatibility changes, read the changelog before updating, and
> keep current backups.

## Why it exists

Pop Agent is built around four product decisions:

- **One continuous conversation surface.** Use the browser, install the PWA on
  a phone or desktop, or work from the `pop` CLI without creating separate
  histories.
- **Provider choice without a second data silo.** Configure supported API or
  subscription providers and choose models per conversation.
- **Local ownership.** Conversations, memory, files, notes, skills, schedules,
  usage records, and encrypted provider credentials live on your server.
- **An agent that can actually work.** Server tools, web access, MCP, outbound
  A2A, scheduled tasks, voice transcription, and optional access to a selected
  desktop through Pop Local Access share one explicit security boundary.

Pop Agent is permanently single-user and has no telemetry. Network calls happen
only for configured or explicitly used features.

## What is included

- Durable streaming chat with queued follow-ups, attachments, image input,
  local voice transcription, model selection, and usage accounting
- Searchable history, living memory, a plain-folder Files area, private Notes,
  reviewed Skills, and scheduled background tasks
- Multiple providers with failover, encrypted credentials, OAuth where
  supported, and provider-specific usage views
- Native MCP client integration and outbound A2A agents with persisted tasks
- Installable responsive PWA, terminal client, and optional macOS/Windows Pop
  Local Access tray
- Manual backups, recovery keys, passkeys, session controls, update validation,
  and rollback-aware server activation

## Install on Ubuntu

The supported server is a fresh **Ubuntu systemd** host on **amd64 or arm64**.
Use a non-root account with `sudo`, Git, and outbound HTTPS. The bootstrap
installs a fixed apt prerequisite set plus Tailscale, downloads repository-pinned Node, Go,
and `whisper.cpp` archives with size/SHA-256 verification, runs the complete
repository gate, and installs a loopback-only systemd service.

```sh
git clone https://github.com/viniciusbuscacio/pop-agent.git
cd pop-agent
./deploy/bootstrap-server.sh --install-apt-packages
```

Defaults:

- source: the cloned repository;
- data: `$HOME/.pop-agent`;
- user workspace: `$HOME/pop-agent-workspace`;
- service: `pop-agent-service.service`;
- server manager: `/usr/local/bin/popman`;
- app origin: loopback-only `http://127.0.0.1:8787` behind Tailscale Serve;
- temporary setup page: `http://<private-LAN-IP>:8788/setup`.

Do not run the bootstrap as root. Custom paths, ports, preparation-only mode,
verified offline bundles, exact trust boundaries, and failure recovery are in
the [deployment guide](deploy/README.md) and
[installation specification](docs/specs/Spec-Pop-Installation.md).

### Private HTTPS with Tailscale

The installer prints a temporary private-LAN URL and a one-time code. Open that
URL, enter the code, sign the server into your tailnet, and explicitly enable
private HTTPS. Pop Agent configures Tailscale Serve for its loopback origin and
never enables Funnel. The browser device must be connected to the same tailnet.
Do **not** expose port 8787 directly.

No password is accepted on the temporary HTTP surface. It exposes only this
bounded network setup and disappears after first-owner setup completes. If its
15-minute code expires, run `popman onboarding-code` on the server. Existing
Caddy or manually managed installations can use `--skip-network-onboarding`;
`deploy/configure-tailscale.sh` remains an explicit repair/manual helper.

### First run

1. Follow the printed HTTP URL through Tailscale login and private HTTPS.
2. Continue at the generated `https://…ts.net` URL and create the one owner password.
3. Save the one-time recovery key somewhere separate and secure.
4. Add and test a model provider in Settings.
5. Create a manual backup and separately protect the host's `secret.key`, which
   is intentionally excluded from Pop Agent backup archives.
6. Optionally install the PWA and the CLI from Settings → Installation.

## Current limits

- Ubuntu is the only supported server OS; there is no Docker or Windows server
  distribution.
- The product is permanently single-user. Multi-user accounts and hosted cloud
  sync are out of scope.
- Remote use requires a stable HTTPS origin, normally Tailscale Serve or a
  correctly configured reverse proxy.
- Model/provider accounts and their charges are external to Pop Agent.
- Voice runs on the server and requires local disk for the selected Whisper
  model. The installer supplies `ffmpeg` and the pinned `whisper.cpp` runtime.
- Files uploads are limited to 100 MiB per file. Chat accepts up to eight
  attachments, 25 MiB each and 100 MiB combined. Audio notes remain 25 MiB.
- PWA builds update automatically. Server and AI-runtime activation remain
  explicit, gate-verified actions during beta.
- There is no telemetry, hosted monitoring, uptime SLA, or guaranteed support
  response time.

## Development

Development requires Node.js `>=22.19.0`, npm, Go `>=1.23`, Git, and the native
build tools used by the locked dependencies.

```sh
git clone https://github.com/viniciusbuscacio/pop-agent.git
cd pop-agent
npm ci
npm run build
dev_root=$(mktemp -d)
POP_AGENT_DATA_DIR="$dev_root/data" \
  POP_AGENT_WORKSPACE="$dev_root/workspace" \
  npm run dev
```

For live PWA rebuilds, use a second terminal:

```sh
npm run dev -w @pop-agent/web
```

Before opening a pull request, run the same gate used by CI:

```sh
npm run gate
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making a change. Use GitHub
Issues for reproducible bugs, Discussions for questions and ideas, and the
private process in [SECURITY.md](SECURITY.md) for vulnerabilities.

## Documentation

- [General specification and normative index](docs/specs/Spec-Pop-General.md)
- [Deployment guide](deploy/README.md)
- [Installation, distribution, and updates](docs/specs/Spec-Pop-Installation.md)
- [Deployment and operations](docs/specs/Spec-Pop-Deployment-and-Operations.md)
- [Security model](docs/specs/Spec-Pop-Security.md)
- [CLI and Local Access guide](docs/cli.md)
- [MCP compatibility notes](docs/mcp.md)
- [Changelog](CHANGELOG.md)
- [Support policy](SUPPORT.md)
- [Maintainer release runbook](docs/RELEASING.md)

## License

[MIT](LICENSE) © 2026 Vinicius Buscacio.
