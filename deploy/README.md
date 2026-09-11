# Server deployment files

## Recommended Git clone install

On a fresh Ubuntu amd64 host, run as the non-root service owner:

```sh
git clone --depth 1 https://github.com/viniciusbuscacio/pop-agent.git
cd pop-agent
./deploy/bootstrap-server.sh --install-apt-packages
```

### Private repositories

Authenticate Git once as the same non-root service owner, then use the same clone
and bootstrap commands above:

```sh
sudo apt-get update
sudo apt-get install -y git gh
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git --hostname github.com
git clone --depth 1 https://github.com/viniciusbuscacio/pop-agent.git
cd pop-agent
./deploy/bootstrap-server.sh --install-apt-packages
```

Complete the device code in your browser using an account with repository access.
Do not put access tokens in clone URLs, shell arguments or installer scripts.
Git uses the GitHub CLI credential helper. A headless host may store GitHub CLI
credentials in its owner-protected configuration if no system credential store
is available; this is separate from Pop's provider credentials. Public repositories do not require these GitHub authentication steps.

The bootstrap defaults to `$HOME/.pop-agent` for durable data,
`$HOME/pop-agent-workspace` for the user workspace, and port 8787. Override
those with `--data-dir`, `--workspace`, and `--port` when needed. A successful
install downloads the prebuilt server with the current CLI tarball and platform
manifests. Launcher, PLA and client Node binaries are fetched, verified and cached
when a client requests its platform. It also places the server manager at `/usr/local/bin/popman`, bound to the
managed Node runtime and those exact data/workspace paths.

On a fresh data directory it also prints `http://<private-LAN-IP>:8788/setup`
and a 15-minute one-time code. That restricted page guides Tailscale login and
private HTTPS, then sends the owner to the resulting `https://…ts.net` origin
before accepting a master password. Use `popman onboarding-code` if the code
expires. Use `--skip-network-onboarding` only when another HTTPS edge such as
Caddy is already operator-managed.

## Install a specific version

Retrieve the immutable v0.2.91 installer over HTTPS into an owner-only
temporary file. The download must complete successfully before the file is
executed, the installer and acquired source use the same release ref, and the
subshell always removes the temporary file:

```sh
(umask 077; file=$(mktemp "${TMPDIR:-/tmp}/pop-server-install.XXXXXX") || exit; trap 'status=$?; rm -f "$file"; exit "$status"' 0; trap 'exit 1' 1 2 3 15; curl -q --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output "$file" https://raw.githubusercontent.com/viniciusbuscacio/pop-agent/v0.2.91/server-install.sh && sh "$file" --ref v0.2.91)
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
can prepare the narrowly supported host/toolchain layer and hand off to
the production systemd installer:

```sh
deploy/bootstrap-server.sh --install-apt-packages
```

Run it as the non-root checkout owner. The bootstrap refuses root, other Linux
distributions, other operating systems, and unsupported CPU architectures. It
downloads exact official Node and `whisper.cpp` archives declared in
`server-toolchain-manifest.tsv`, verifies pinned sizes and SHA-256 values before
extraction, screens archive roots/paths/link targets, smokes each staged runtime,
and atomically points `current/node` and `current/whisper` at the new generation. The
default Pop-owned per-user location is:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/pop-agent/server-toolchain
```

Matching verified runtimes and downloaded archives are reused on a rerun. Node,
npm and `whisper-cli` are put first on `PATH` only inside the bootstrap/handoff process;
no system-wide runtime or shell profile is modified.

The script does not silently mutate apt. If the host needs the narrow download
prerequisites, opt in explicitly:

```sh
deploy/bootstrap-server.sh \
  --install-apt-packages \
  --data-dir /absolute/owner-owned/data \
  --workspace /absolute/owner-owned/workspace \
  --port 8787
```

That flag permits only `sudo apt-get update`, the pinned official Tailscale apt
key/repository, and installation of
`ca-certificates`, `curl`, `git`, `xz-utils`, `tar`, `libgomp1` and `libstdc++6`
when missing. Local voice uses the bundled audio-only FFmpeg
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

## Prebuilt server installation

Normal installation requires a published release for the exact source commit.
The bootstrap downloads the architecture-specific JSON manifest and tarball
from the origin GitHub repository's `v<VERSION>` release. Private downloads use
the existing GitHub CLI login; public releases need no GitHub account. A missing
or incompatible release fails with a clear message, without silently compiling.

The manifest binds version, commit, source tree, exact Node runtime, Linux
architecture, minimum glibc, archive byte size/SHA-256 and the build gate date.
Prebuilt packages target Ubuntu 24.04 or newer on amd64. ARM64 server publication is paused. The installer
checks metadata and bytes, screens archive paths/links, and extracts into an
isolated owner-only generation beneath:

```text
${XDG_DATA_HOME:-$HOME/.local/share}/pop-agent/server-releases
```

It loads native SQLite, Argon2, Sharp, embeddings and pi dependencies, performs
an offline ONNX CPU inference without GPU libraries, then runs
14 functional checks against the built application with temporary data and a
fake provider. No model request or user database is involved. There is no npm
install, TypeScript build, Go build or full development suite on this path.
Verified archives survive retries. Node and Whisper downloads run in parallel.
An audio-only FFmpeg binary and Whisper remain part of the default installation.
The normal apt path excludes the distribution FFmpeg package and its graphical/video
dependencies. Release builders run real speech conversion and Whisper tests before
publication; those tests do not run during host installation.

Only after these checks does the shared systemd installer activate the staged
runtime, pin popman to it, and check service health. The source clone remains
available for inspection; the running generation has the same clean Git commit.
On a failed replacement activation, the previous unit and popman launcher are
restored and the previous service is restarted. Historical generations are not
removed automatically. Existing server update controls still require their
explicit prepared-checkout gate; this does not weaken update authorization.

For an offline release, set `POP_AGENT_SERVER_RELEASE_DIR` to a trusted directory
containing the architecture manifest and archive when invoking the bootstrap.
The directory is operator-trusted release material; all metadata and checksum
checks still apply. Source bundles alone do not contain runtime dependencies.

## Developer source-build alternative

To deliberately compile on the target host (including unpublished commits):

```sh
./deploy/bootstrap-server.sh --install-apt-packages --build-from-source
```

This explicit path additionally installs `build-essential` and `python3`,
prepares the pinned Go runtime, and invokes `npm run install:server` with the
selected data/workspace/port arguments. It retains `npm ci`, the complete gate,
client packaging, and the shared systemd activation and health checks.
`--prepare-only --build-from-source` prepares that development toolchain only.

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

## Installation logs

The installer prints its log path at the start and on completion/failure.
Logs are stored in ~/.local/state/pop-agent/install-logs/ (or under
$XDG_STATE_HOME). Source acquisition and host bootstrap produce separate files;
the bootstrap log includes runtime verification and service activation.
Re-running preserves earlier logs.

For a bug report, attach the files from the failed attempt and describe the last
visible error. The logs contain structured phases, versions, status codes and
timings; they do not capture terminal output or pairing/authentication secrets.
They are local files and are never uploaded automatically.

For a failure after the browser opens, preserve the VM and collect the recent
service journals as well:

    sudo journalctl -u pop-agent-service.service -u tailscaled --since "30 minutes ago" --no-pager

Review service journal contents before sharing them. A restored snapshot removes
the failed attempt's later state and diagnostics.

## Maintainer builds on ubuntu-home

Before a complete Linux build, prepare the exact clean release commit on a Mac
with Xcode command-line tools and Go. Run
`node tools/macos-tray-artifacts.ts build /absolute/path/to/macos-tray-output`.
Copy manifest.json, the native executables and setup DMGs (not the temporary
tooling directory) into the Ubuntu builder's
`~/.local/share/pop-agent/release-builder/cache/macos-tray/<full-commit>/`.
The Mac stage tests the native tray, builds Apple Silicon and Intel executables,
and verifies their ad-hoc signatures. Linux validates commit, version, Mach-O
architecture, size and SHA-256 before running its gate. Missing or mismatched
Mac artifacts stop the default build rather than producing a broken Mac
installer.

Run `./deploy/local-release.sh build` for a complete committed publication batch.
When the owner explicitly needs Windows-first validation, run
`./deploy/local-release.sh build-windows`; this deliberately omits macOS Pop
Local Access from that immutable version, so macOS update discovery returns 404
until a later version is built with the Mac stage. Then run
`./deploy/local-release.sh publish` when the verified batch should be sent to
GitHub.
The first build prepares an Ubuntu 24.04 Docker image; later builds reuse it,
locked dependencies and verified audio artifacts. Authentication is configured
once with `./deploy/local-release.sh auth` (GitHub token on stdin). Credentials
are isolated from builds. State and bundles live under
`~/.local/share/pop-agent/release-builder`. No GitHub Actions runner is required.

### Installation output

The interactive checkout installer shows concise progress. Press **D** at any time
while it runs to reveal technical output, including earlier redacted details.
To start with details:

```sh
./deploy/bootstrap-server.sh --install-apt-packages --verbose
```

The terminal prints the private `details-*.log` path at completion or failure.
Package-manager output is retained there; passwords, authentication and the
one-time setup code are excluded. Existing structured installation logs remain
available. Piped/noninteractive installation retains plain output without a key
listener. No new system package is needed for this presentation.

## Data and backup privacy

The database, conversations, files, notes, and pi-managed provider sign-in tokens
are not encrypted by Pop Agent. SecretsRepo values use separate field
encryption. The service uses `UMask=0077` for newly created files; existing data
and backups must also be restricted to the owner.

New `.popbackup` archives require a separate password configured in Settings →
Backup. The password is saved encrypted for reuse by manual and operator-scheduled
backups. Legacy `.tar.gz` archives remain unencrypted and can include provider
sign-in tokens. `secret.key` is excluded from both formats. Use disk encryption on the Ubuntu server and
protect backups during storage and transfer. Preserve `secret.key` separately
if you need to recover SecretsRepo credentials on another host.
