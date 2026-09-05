# Server deployment files

## Recommended Git clone install

On a fresh Ubuntu amd64/arm64 host, run as the non-root service owner:

```sh
git clone https://github.com/viniciusbuscacio/pop-agent.git
cd pop-agent
./deploy/bootstrap-server.sh --install-apt-packages
```

The bootstrap defaults to `$HOME/.pop-agent` for durable data,
`$HOME/pop-agent-workspace` for the user workspace, and port 8787. Override
those with `--data-dir`, `--workspace`, and `--port` when needed. A successful
install also places the server manager at `/usr/local/bin/popman`, bound to the
managed Node runtime and those exact data/workspace paths.

On a fresh data directory it also prints `http://<private-LAN-IP>:8788/setup`
and a 15-minute one-time code. That restricted page guides Tailscale login and
private HTTPS, then sends the owner to the resulting `https://…ts.net` origin
before accepting a master password. Use `popman onboarding-code` if the code
expires. Use `--skip-network-onboarding` only when another HTTPS edge such as
Caddy is already operator-managed.

## Fixed-ref GitHub acquisition

Retrieve the planned immutable v0.2.48 installer over HTTPS into an owner-only
temporary file. The download must complete successfully before the file is
executed, the installer and acquired source use the same release ref, and the
subshell always removes the temporary file:

```sh
(umask 077; file=$(mktemp "${TMPDIR:-/tmp}/pop-server-install.XXXXXX") || exit; trap 'status=$?; rm -f "$file"; exit "$status"' 0; trap 'exit 1' 1 2 3 15; curl -q --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output "$file" https://raw.githubusercontent.com/viniciusbuscacio/pop-agent/v0.2.48/server-install.sh && sh "$file" --ref v0.2.48)
```

Options belong after the temporary filename. For example, add `--prepare-only`
or `--no-install-apt-packages` to the final `sh` invocation. An operator can
instead select a reviewed full commit with `--ref <full-commit>`. Keep the
temporary-file, trap, complete-download, and `sh "$file" [options]` steps; never
use a producer-to-shell pipeline.

Public repositories need only Git for source acquisition. An authenticated
GitHub CLI session is optional and supports private or access-controlled
repositories and forks; when it is available, `server-install.sh` uses `gh repo
clone` plus `gh api` confirmation instead. Each path clones without a checkout,
resolves a branch, tag, or full commit from that clone, rejects a name shared
by both a branch and tag, checks out one exact detached commit, and
validates a complete clean tree before activation. The defaults are
`$HOME/pop-agent`, `$HOME/.pop-agent`, `$HOME/pop-agent-workspace`, port 8787,
and opt-in to the bootstrap's fixed apt prerequisite allowlist.

The acquisition command refuses root, unsupported non-Ubuntu hosts, unsafe
or overlapping paths, insecure destination ancestry, symlinked required files
(including the pinned toolchain manifest), and every existing destination. A
public HTTPS failure reports repository access and identifies authenticated gh
as the private/access-controlled alternative. Public Git acquisition isolates
Git configuration and disables ambient credential helpers. Temporary owner-only
staging is always removed.
If downstream bootstrap fails, the activated checkout remains and the installer
prints the exact bootstrap retry command; rerunning acquisition is intentionally
refused because its destination now exists. Before handoff the script unsets
common token, askpass, and SSH-agent environment variables. It neither puts
tokens in URLs/argv/logs nor makes host credential files inaccessible; those
files remain governed by host permissions and credential-tool configuration.
The fresh guided path prepares Tailscale and private TLS but leaves tailnet
authorization and account setup as explicit browser actions. Firewall policy
and alternative proxies remain operator-owned. The bootstrap handoff and printed retry command use the same
minimal explicit environment rather than inherited Git/token/agent variables.

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

For an **existing Pop Agent checkout**, Ubuntu operators on amd64
or arm64 can prepare the narrowly supported host/toolchain layer and hand off to
the production systemd installer:

```sh
deploy/bootstrap-server.sh --install-apt-packages
```

Run it as the non-root checkout owner. The bootstrap refuses root, other Linux
distributions, other operating systems, and unsupported CPU architectures. It
downloads exact official Node, Go, and `whisper.cpp` archives declared in
`server-toolchain-manifest.tsv`, verifies pinned sizes and SHA-256 values before
extraction, screens archive roots/paths/link targets, smokes each staged runtime,
and atomically points `current/node`, `current/go`, and `current/whisper` at the new generation. The
default Pop-owned per-user location is:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/pop-agent/server-toolchain
```

Matching verified runtimes and downloaded archives are reused on a rerun. Node,
npm, Go, and `whisper-cli` are put first on `PATH` only inside the bootstrap/handoff process;
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

That flag permits only `sudo apt-get update`, the pinned official Tailscale apt
key/repository, and installation of
`ca-certificates`, `curl`, `git`, `xz-utils`, `tar`, `build-essential`, and
`python3` (required by native npm package builds), `ffmpeg` for local voice
transcription, and `tailscale` for guided private HTTPS. The key download is
size/SHA-256 verified before root installation.
Runtime downloads use `curl` as archive downloads; no remote script is piped to
a shell.

To prepare/verify the host without invoking the systemd handoff, add
`--prepare-only`. Use `--checkout /absolute/existing/checkout` when the script
is not being run from its own checkout, and `--toolchain-dir /absolute/path` to
override the per-user toolchain location.

Version/hash maintenance is intentionally data-only: update all six
amd64/arm64 Node/Go/whisper.cpp rows in `server-toolchain-manifest.tsv` from
the official Node, Go, and whisper.cpp release metadata, including byte sizes. The
metadata regression test enforces the target matrix, official URL shape, exact
hash syntax, and compatibility with the repository Node minimum.

This bootstrap does **not** acquire source, provision Linux, open firewalls,
enable Funnel, configure Caddy, or create a Pop account. The default fresh path
does install/start Tailscale and delegate its CLI to the non-root service user;
the paired browser owns login and Serve HTTPS activation. It
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
without root, uses narrowly scoped sudo to assign the service user as the
Tailscale operator, install the root-owned `popman`
launcher and activate the systemd unit, and performs bounded loopback health
verification.

The former `pop-agent-service.service` was an ubuntu-home development unit with
machine-specific paths and a source-level `tsx` command. It was removed so it
cannot be mistaken for the production service. `tools/install-systemd.ts` is the
source of the installed unit.

`journald-retention.conf` remains an optional operator-managed journal policy;
it is not installed by either server installation layer.

## Tailscale Serve helper

After the loopback health check succeeds, an operator who has independently
installed and authenticated Tailscale can configure tailnet-only HTTPS with:

```sh
deploy/configure-tailscale.sh --port 8787
```

The helper first checks `http://127.0.0.1:8787/healthz` and the current
`tailscale status`, then runs `tailscale serve --bg
http://127.0.0.1:8787`. It never installs Tailscale, starts an account login,
changes tailnet policy, or uses Funnel. Pop Agent remains loopback-only while
Tailscale owns the authenticated HTTPS edge.
