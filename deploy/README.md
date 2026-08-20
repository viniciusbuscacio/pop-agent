# Server deployment files

The production systemd unit is generated and installed from an existing prepared
checkout by:

```sh
npm run install:server -- \
  --data-dir /absolute/owner-owned/data \
  --workspace /absolute/owner-owned/workspace
```

Run it as the non-root checkout owner on a Linux host already providing systemd,
Node 22.19+, npm, Git, Go 1.23+, and the other commands checked by the installer.
It runs `npm ci` and the complete repository gate before narrowly scoped `sudo`
installation and bounded loopback health verification. It does not install or
configure system packages, a reverse proxy, TLS, DNS, Tailscale, Caddy, FFmpeg,
or Git.

The former `pop-agent-service.service` was an ubuntu-home development unit with
machine-specific paths and a source-level `tsx` command. It was removed so it
cannot be mistaken for the production service. `tools/install-systemd.ts` is the
source of the installed unit.

`journald-retention.conf` remains an optional operator-managed journal policy;
it is not installed by the server installer.
