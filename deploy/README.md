# Server deployment files

## Local source acquisition

A clean committed checkout can be packed into an immutable local Git bundle:

```sh
npm run pack:server-source -- --output-dir /absolute/release-directory
```

The command writes a commit/version-named `.bundle` and matching `.sha256` file
outside the source checkout, and prints the exact bundle path, SHA-256, commit
and version. Existing versioned output is accepted only when every byte matches.

Copy or bind-mount the bundle and the small installer into the target machine,
then acquire exactly that commit without any network request:

```sh
deploy/install-server-bundle.sh \
  --bundle /absolute/pop-agent.bundle \
  --sha256 <lowercase-sha256> \
  --commit <full-git-commit> \
  --destination /absolute/new-checkout \
  --data-dir /absolute/data \
  --workspace /absolute/workspace \
  --install-apt-packages
```

The installer verifies the local file hash, runs `git bundle verify`, clones to
staging, checks out the exact detached commit, verifies a complete clean Pop
checkout, atomically activates a previously absent destination, then hands off
to the host bootstrap below. It refuses root, symlink bundles, unsafe paths,
corruption, absent commits and existing destinations. The apt opt-in installs
Git for acquisition and is forwarded to the host bootstrap. This layer has no
HTTP client, remote manifest or source download behavior.

## Existing-checkout host bootstrap

For an **existing Pop Agent checkout**, Ubuntu/Debian Linux operators on amd64
or arm64 can prepare the narrowly supported host/toolchain layer and hand off to
the production systemd installer:

```sh
deploy/bootstrap-server.sh \
  --data-dir /absolute/owner-owned/data \
  --workspace /absolute/owner-owned/workspace \
  --port 8787
```

Run it as the non-root checkout owner. The bootstrap refuses root, other Linux
distributions, other operating systems, and unsupported CPU architectures. It
downloads exact official Node and Go archives declared in
`server-toolchain-manifest.tsv`, verifies pinned sizes and SHA-256 values before
extraction, screens archive roots/paths/link targets, smokes each staged runtime,
and atomically points `current/node` and `current/go` at the new generation. The
default Pop-owned per-user location is:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/pop-agent/server-toolchain
```

Matching verified runtimes and downloaded archives are reused on a rerun. Node,
npm, and Go are put first on `PATH` only inside the bootstrap/handoff process;
no system-wide runtime or shell profile is modified.

The script does not silently mutate apt. If the host needs the narrow download
and build prerequisites, opt in explicitly:

```sh
deploy/bootstrap-server.sh \
  --install-apt-packages \
  --data-dir /absolute/owner-owned/data \
  --workspace /absolute/owner-owned/workspace \
  --port 8787
```

That flag permits only `sudo apt-get update` and installation of
`ca-certificates`, `curl`, `git`, `xz-utils`, `tar`, `build-essential`, and
`python3` (required by native npm package builds).
Runtime downloads use `curl` as archive downloads; no remote script is piped to
a shell.

To prepare/verify the host without invoking the systemd handoff, add
`--prepare-only`. Use `--checkout /absolute/existing/checkout` when the script
is not being run from its own checkout, and `--toolchain-dir /absolute/path` to
override the per-user toolchain location.

Version/hash maintenance is intentionally data-only: update all four
amd64/arm64 Node/Go rows in `server-toolchain-manifest.tsv` from the official
Node `SHASUMS256.txt` and Go download metadata, including byte sizes. The
metadata regression test enforces the target matrix, official URL shape, exact
hash syntax, and compatibility with the repository Node minimum.

This bootstrap does **not** acquire source, provision Linux, configure DNS, TLS,
firewalls, Tailscale, Caddy, a reverse proxy, FFmpeg, or create a Pop account. It
is not a universal or public installer. Host and apt security updates remain the
operator's responsibility.

## Prepared-checkout systemd installer

The bootstrap ultimately executes this existing delivered command with explicit
arguments:

```sh
npm run install:server -- \
  --data-dir /absolute/owner-owned/data \
  --workspace /absolute/owner-owned/workspace \
  --port 8787
```

It validates Linux/systemd, Node 22.19+, npm, Git, Go 1.23+, required commands,
checkout ownership and cleanliness. It then runs `npm ci` and the complete gate
without root, uses narrowly scoped sudo for systemd unit activation, and performs
bounded loopback health verification.

The former `pop-agent-service.service` was an ubuntu-home development unit with
machine-specific paths and a source-level `tsx` command. It was removed so it
cannot be mistaken for the production service. `tools/install-systemd.ts` is the
source of the installed unit.

`journald-retention.conf` remains an optional operator-managed journal policy;
it is not installed by either server installation layer.
