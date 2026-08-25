# Pop Agent

Pop Agent is a self-hosted, single-user personal agent platform. It combines a
browser PWA and terminal client with the [pi agent](https://pi.dev) running on
your server.
Conversations, memory, files, notes, skills, schedules, and provider settings
remain under your control.

- Durable chat over HTTP + SSE with attachments, voice, image input, and usage
  tracking
- Searchable conversation history, living memory, Files, and private Notes
- Multiple model providers, server tools, web access, MCP, and outbound A2A
- Installable PWA, the `pop` terminal client, and optional Pop Local Access
- Single-user by design and zero telemetry; outbound traffic is limited to
  configured or explicitly used product features

> [!WARNING]
> Pop Agent is pre-1.0. It is used in active development and may make intentional
> compatibility changes. Review the changelog and keep current backups before
> updating.

## Install a server

The supported server host is a fresh **Ubuntu or Debian systemd** machine on
**amd64 or arm64**. Use a non-root account with narrowly scoped `sudo` access,
and ensure `curl`, Git, and outbound HTTPS are available. The installer prepares
repository-pinned Node and Go toolchains, installs build prerequisites from a
fixed apt allowlist, runs the complete gate, and creates a loopback-only systemd
service.

The following example is pinned to the planned `v0.2.41` tag. Run it only after
the repository is public and that tag is published; inspect the tagged script
first if desired.

```sh
version=v0.2.41
(
  umask 077
  file=$(mktemp "${TMPDIR:-/tmp}/pop-server-install.XXXXXX") || exit
  trap 'status=$?; rm -f "$file"; exit "$status"' 0
  trap 'exit 1' 1 2 3 15
  curl -q --fail --silent --show-error --location \
    --proto '=https' --proto-redir '=https' --tlsv1.2 \
    --output "$file" \
    "https://raw.githubusercontent.com/viniciusbuscacio/pop-agent/$version/server-install.sh" \
    && sh "$file" --ref "$version"
)
```

Do not run the installer as root or pipe a remote script directly into a shell.
See the [installation specification](docs/specs/Spec-Pop-Installation.md) for
options, offline bundle acquisition, exact trust boundaries, and recovery from
a partial installation.

### First run and HTTPS

The installer deliberately stops at a healthy service bound to
`127.0.0.1:8787`. The operator must separately configure DNS, firewall policy,
and a reverse proxy or tunnel that provides a stable HTTPS origin. Do **not**
expose port 8787 directly. The proxy must preserve SSE streaming and WebSocket
upgrades; Caddy or `tailscale serve` are the documented deployment shapes.
Remote plain HTTP is unsupported.

After HTTPS is working:

1. Open the HTTPS origin and create the single owner password.
2. Save the one-time recovery key somewhere separate and secure.
3. Add provider access through Pop Agent's settings; do not put credentials in
   installer arguments, environment examples, issues, or logs.
4. Configure and test backups. The host's `secret.key` is intentionally excluded
   from backup archives and needs a separate secure recovery plan.

Pop Agent does not provision Linux, DNS, TLS, a firewall, a reverse proxy,
Tailscale, provider accounts, or host backups. The operator remains responsible
for those systems and for OS security updates. See
[Deployment and Operations](docs/specs/Spec-Pop-Deployment-and-Operations.md).

## Development

Prerequisites are Node.js `>=22.19.0`, npm, Go `>=1.23`, Git, and the native
build tools required by the locked npm dependencies.

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

For frontend rebuilds while the server is running, use another terminal:

```sh
npm run dev -w @pop-agent/web
```

Before opening a pull request, run the same repository gate used by CI:

```sh
npm run gate
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before making a change.

## Documentation

- [General specification and normative index](docs/specs/Spec-Pop-General.md)
- [Installation, distribution, and updates](docs/specs/Spec-Pop-Installation.md)
- [Deployment guide](deploy/README.md)
- [Deployment and operations](docs/specs/Spec-Pop-Deployment-and-Operations.md)
- [Security model](docs/specs/Spec-Pop-Security.md)
- [CLI and Local Access guide](docs/cli.md)
- [Changelog](CHANGELOG.md)
- [Security reporting](SECURITY.md)
- [Support policy](SUPPORT.md)
- [Maintainer release runbook](docs/RELEASING.md)

## License

[MIT](LICENSE) © 2026 Vinicius Buscacio.
