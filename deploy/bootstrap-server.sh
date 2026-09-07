#!/bin/sh
set -eu

# A single interactive presenter owns the terminal across nested installers.
case " ${*} " in
  *" --help "*|*" -h "*) ;;
  *)
    console_helper=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)/install-console.sh
    if [ "${POP_AGENT_INSTALL_UI_ACTIVE:-0}" != 1 ] && [ -t 0 ] && [ -t 1 ] && [ -f "$console_helper" ] && command -v bash >/dev/null 2>&1; then
      exec bash "$console_helper" "$0" "$@"
    fi
    ;;
esac

# BEGIN INSTALL JOURNAL (kept identical in both standalone entry points)
INSTALL_LOG_FILE=
INSTALL_LOG_PHASE=preflight
INSTALL_LOG_STARTED=0
POP_AGENT_INSTALL_LOG_ACTIVE=0
export POP_AGENT_INSTALL_LOG_ACTIVE
install_event() {
  [ -n "$INSTALL_LOG_FILE" ] || return 0
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" >&3 || :
}
install_phase() {
  INSTALL_LOG_PHASE=$1
  install_event "event=phase phase=$1"
  if [ "${POP_AGENT_INSTALL_UI_ACTIVE:-0}" = 1 ]; then printf '[pop-step] %s\n' "$1"; fi
}
install_log_init() {
  # Never capture stdout/stderr, arguments, environment or authentication output.
  for log_command in date mkdir stat id mktemp; do
    command -v "$log_command" >/dev/null 2>&1 || return 1
  done
  INSTALL_LOG_STARTED=$(date +%s)
  log_root=${XDG_STATE_HOME:-"$HOME/.local/state"}
  case $log_root in /*) ;; *) return 1 ;; esac
  log_dir=$log_root/pop-agent/install-logs
  (umask 077; mkdir -p -- "$log_dir") || return 1
  [ ! -L "$log_dir" ] && [ -d "$log_dir" ] || return 1
  [ "$(stat -c %u -- "$log_dir")" = "$(id -u)" ] || return 1
  [ "$(stat -c %a -- "$log_dir")" = 700 ] || return 1
  INSTALL_LOG_FILE=$(umask 077; mktemp "$log_dir/install-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.log") || return 1
  exec 3>>"$INSTALL_LOG_FILE"
  POP_AGENT_INSTALL_LOG_ACTIVE=1
  export POP_AGENT_INSTALL_LOG_ACTIVE
  printf 'Installation log: %s\n' "$INSTALL_LOG_FILE"
  install_event "event=start schema=1"
  install_phase preflight
}
install_log_finish() {
  [ -n "$INSTALL_LOG_FILE" ] || return 0
  install_event "event=finish phase=$INSTALL_LOG_PHASE exit_code=$1 duration_seconds=$(($(date +%s) - INSTALL_LOG_STARTED))"
  printf '\nInstallation log: %s\n' "$INSTALL_LOG_FILE" >&2
  if [ "$1" -eq 0 ] && grep -q 'event=setup-code-issued' "$INSTALL_LOG_FILE"; then
    printf '%s\n' 'If the setup code expires, run: popman onboarding-code' >&2
  fi
}
case " ${*} " in
  *" --help "*|*" -h "*) ;;
  *) install_log_init || printf '%s\n' 'Warning: installation logging could not be initialized.' >&2 ;;
esac
# END INSTALL JOURNAL

PROGRAM=${0##*/}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
MANIFEST=$SCRIPT_DIR/server-toolchain-manifest.tsv
CHECKOUT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
TOOLCHAIN_DIR=${XDG_DATA_HOME:-"$HOME/.local/share"}/pop-agent/server-toolchain
DATA_DIR=$HOME/.pop-agent
WORKSPACE=$HOME/pop-agent-workspace
PORT=8787
INSTALL_APT=0
PREPARE_ONLY=0
BUILD_FROM_SOURCE=0
NETWORK_ONBOARDING=1
STAGING_DIR=
RELEASE_SOURCE_DIR=
TAILSCALE_KEY_TEMP=
TAILSCALE_LIST_TEMP=
node_download_pid=
whisper_download_pid=

say() {
  printf '%s\n' "$*"
}

die() {
  printf '%s: %s\n' "$PROGRAM" "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$RELEASE_SOURCE_DIR" ] && [ -d "$RELEASE_SOURCE_DIR" ]; then rm -rf -- "$RELEASE_SOURCE_DIR"; fi
  for download_pid in "$node_download_pid" "$whisper_download_pid"; do
    if [ -n "$download_pid" ]; then
      kill "$download_pid" 2>/dev/null || true
      wait "$download_pid" 2>/dev/null || true
    fi
  done
  if [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ]; then
    rm -rf -- "$STAGING_DIR"
  fi
  [ -z "$TAILSCALE_KEY_TEMP" ] || rm -f -- "$TAILSCALE_KEY_TEMP"
  [ -z "$TAILSCALE_LIST_TEMP" ] || rm -f -- "$TAILSCALE_LIST_TEMP"
}
trap 'install_status=$?; cleanup; install_log_finish "$install_status"' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

usage() {
  cat <<'EOF'
Prepare an Ubuntu host for an existing Pop Agent checkout.

Usage:
  deploy/bootstrap-server.sh [options]

Options:
  --checkout PATH              Existing Pop Agent checkout (default: script's repository)
  --toolchain-dir PATH         Pop-owned per-user runtime directory
  --data-dir PATH              Server data directory (default: $HOME/.pop-agent)
  --workspace PATH             Server workspace directory (default: $HOME/pop-agent-workspace)
  --port PORT                  Server loopback port (default: 8787)
  --install-apt-packages       Explicitly allow the narrow apt prerequisite phase
  --build-from-source          Developer path: install compilers, build and run the full gate
  --verbose                    Show detailed installation output immediately
  --prepare-only               Prepare and verify the toolchain without invoking systemd installation
  --skip-network-onboarding    Do not prepare the temporary HTTP/Tailscale setup flow
  -h, --help                   Show this help

The normal fresh-host path installs Tailscale and delegates its CLI to the service user.
It never exposes a password on HTTP; account setup begins only after private HTTPS works.
It never pipes a remote script to a shell and never installs Node, Go, or whisper.cpp system-wide.
EOF
}

require_value() {
  [ "$#" -ge 2 ] || die "$1 requires a value"
  case $2 in --*) die "$1 requires a value" ;; esac
}

while [ "$#" -gt 0 ]; do
  case $1 in
    --checkout)
      require_value "$@"
      CHECKOUT=$2
      shift 2
      ;;
    --toolchain-dir)
      require_value "$@"
      TOOLCHAIN_DIR=$2
      shift 2
      ;;
    --data-dir)
      require_value "$@"
      DATA_DIR=$2
      shift 2
      ;;
    --workspace)
      require_value "$@"
      WORKSPACE=$2
      shift 2
      ;;
    --port)
      require_value "$@"
      PORT=$2
      shift 2
      ;;
    --install-apt-packages)
      INSTALL_APT=1
      shift
      ;;
    --build-from-source)
      BUILD_FROM_SOURCE=1
      shift
      ;;
    --prepare-only)
      PREPARE_ONLY=1
      shift
      ;;
    --skip-network-onboarding)
      NETWORK_ONBOARDING=0
      shift
      ;;
    --verbose) shift ;;
    -h|--help)
      usage
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
done

safe_absolute_path() {
  label=$1
  value=$2
  case $value in
    /*) ;;
    *) die "$label must be an absolute path: $value" ;;
  esac
  case $value in
    *[!A-Za-z0-9._+@/-]*|*%*) die "$label contains unsupported characters: $value" ;;
  esac
  [ "$value" != / ] || die "$label must not be the filesystem root"
}

install_phase arguments
safe_absolute_path "checkout" "$CHECKOUT"
safe_absolute_path "toolchain directory" "$TOOLCHAIN_DIR"
safe_absolute_path "data directory" "$DATA_DIR"
safe_absolute_path "workspace" "$WORKSPACE"
case $PORT in
  ''|*[!0-9]*) die "port must be an integer from 1 to 65535: $PORT" ;;
esac
[ "$PORT" -ge 1 ] 2>/dev/null && [ "$PORT" -le 65535 ] 2>/dev/null \
  || die "port must be an integer from 1 to 65535: $PORT"

[ "$(id -u)" -ne 0 ] || die "refusing to run as root; run as the non-root checkout owner"
[ "$(uname -s)" = Linux ] || die "unsupported platform: only Ubuntu Linux is supported"
case $(uname -m) in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported architecture: $(uname -m); supported architectures are amd64 and arm64" ;;
esac

if [ "$ARCH" != amd64 ] && [ "$PREPARE_ONLY" -eq 0 ] && [ "$BUILD_FROM_SOURCE" -eq 0 ] && [ -z "${POP_AGENT_SERVER_RELEASE_DIR:-}" ]; then
  die "prebuilt server releases currently support amd64 only; ARM64 publication is paused"
fi

install_phase platform
install_event "event=platform os=linux architecture=$ARCH"
OS_RELEASE_FILE=${POP_AGENT_OS_RELEASE_FILE:-/etc/os-release}
[ -f "$OS_RELEASE_FILE" ] && [ -r "$OS_RELEASE_FILE" ] || die "cannot identify the Linux distribution from $OS_RELEASE_FILE"
DIST_ID=
DIST_CODENAME=
# ID in os-release is specified as shell-compatible data. Read only this field and
# remove its optional quotes instead of sourcing the whole host-owned file.
while IFS= read -r os_line; do
  case $os_line in
    ID=*)
      DIST_ID=${os_line#ID=}
      DIST_ID=${DIST_ID#\"}
      DIST_ID=${DIST_ID%\"}
      DIST_ID=${DIST_ID#\'}
      DIST_ID=${DIST_ID%\'}
      ;;
    VERSION_CODENAME=*)
      DIST_CODENAME=${os_line#VERSION_CODENAME=}
      DIST_CODENAME=${DIST_CODENAME#\"}
      DIST_CODENAME=${DIST_CODENAME%\"}
      DIST_CODENAME=${DIST_CODENAME#\'}
      DIST_CODENAME=${DIST_CODENAME%\'}
      ;;
  esac
done < "$OS_RELEASE_FILE"
[ "$DIST_ID" = ubuntu ] || die "unsupported Linux distribution '$DIST_ID'; only Ubuntu is supported"

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1 (rerun with --install-apt-packages where applicable)"
}

install_phase prerequisites
if [ "$INSTALL_APT" -eq 1 ]; then
  require_command sudo
  require_command apt-get
  say "Checking the minimal apt prerequisites..."
  missing_packages=
  required_packages='ca-certificates curl git xz-utils tar libgomp1 libstdc++6'
  if [ "$BUILD_FROM_SOURCE" -eq 1 ]; then
    required_packages="$required_packages build-essential python3 ffmpeg"
  fi
  for package in $required_packages; do
    installed_status=$(dpkg-query -W -f='${Status}' "$package" 2>/dev/null || true)
    if [ "$installed_status" != 'install ok installed' ]; then missing_packages="$missing_packages $package"; fi
  done
  if [ -n "$missing_packages" ]; then
    say "Installing missing prerequisites:$missing_packages"
    say "If Ubuntu is updating packages, installation will wait up to 5 minutes for its package lock."
    sudo -- env DEBIAN_FRONTEND=noninteractive apt-get update
    # This list contains only the fixed package names above, never user input.
    sudo -- env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends $missing_packages
  else
    say "Base prerequisites are already installed."
  fi
  if [ "$PREPARE_ONLY" -eq 0 ] && [ "$NETWORK_ONBOARDING" -eq 1 ] && ! command -v tailscale >/dev/null 2>&1; then
    case $DIST_CODENAME in ''|*[!a-z0-9]*) die "unsupported Ubuntu codename for the Tailscale repository: $DIST_CODENAME" ;; esac
    install_phase tailscale-install
    say "Installing Tailscale; waiting up to 5 minutes if Ubuntu is updating packages."
    TAILSCALE_KEY_TEMP=$(mktemp "${TMPDIR:-/tmp}/pop-tailscale-key.XXXXXX") \
      || die "could not create temporary Tailscale key file"
    TAILSCALE_LIST_TEMP=$(mktemp "${TMPDIR:-/tmp}/pop-tailscale-list.XXXXXX") \
      || die "could not create temporary Tailscale repository file"
    curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 \
      --output "$TAILSCALE_KEY_TEMP" https://pkgs.tailscale.com/stable/ubuntu/$DIST_CODENAME.noarmor.gpg \
      || die "could not download the official Tailscale package key"
    tailscale_key_size=$(wc -c < "$TAILSCALE_KEY_TEMP" | tr -d ' ')
    tailscale_key_hash=$(sha256sum "$TAILSCALE_KEY_TEMP") || die "could not hash the Tailscale package key"
    tailscale_key_hash=${tailscale_key_hash%% *}
    [ "$tailscale_key_size" = 2288 ] \
      && [ "$tailscale_key_hash" = 3e03dacf222698c60b8e2f990b809ca1b3e104de127767864284e6c228f1fb39 ] \
      || die "the Tailscale package key did not match the repository-pinned size/SHA-256"
    printf 'deb [signed-by=/usr/share/keyrings/tailscale-archive-keyring.gpg] https://pkgs.tailscale.com/stable/ubuntu %s main\n' \
      "$DIST_CODENAME" > "$TAILSCALE_LIST_TEMP"
    sudo -- install -o root -g root -m 0644 "$TAILSCALE_KEY_TEMP" /usr/share/keyrings/tailscale-archive-keyring.gpg
    sudo -- install -o root -g root -m 0644 "$TAILSCALE_LIST_TEMP" /etc/apt/sources.list.d/tailscale.list
    sudo -- env DEBIAN_FRONTEND=noninteractive apt-get update
    sudo -- env DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends tailscale
  fi
fi

for required in curl git tar xz sha256sum find readlink mktemp mv; do
  require_command "$required"
done
if [ "$PREPARE_ONLY" -eq 0 ]; then
  require_command sudo
  if [ "$NETWORK_ONBOARDING" -eq 1 ]; then
    require_command tailscale
    sudo -- systemctl enable --now tailscaled
  fi
fi

[ -r "$MANIFEST" ] || die "pinned toolchain manifest is missing: $MANIFEST"
[ -d "$CHECKOUT" ] || die "checkout is not a directory: $CHECKOUT"
CHECKOUT=$(CDPATH= cd -- "$CHECKOUT" && pwd -P)
[ -f "$CHECKOUT/package.json" ] && [ -f "$CHECKOUT/package-lock.json" ] \
  || die "checkout is not an existing Pop Agent checkout: $CHECKOUT"

# A normal clone follows development main. Install a published source snapshot
# before reading runtime pins, so source, binaries and toolchain remain one release.
if [ "$PREPARE_ONLY" -eq 0 ] && [ "$BUILD_FROM_SOURCE" -eq 0 ] && [ -z "${POP_AGENT_SERVER_RELEASE_DIR:-}" ]; then
  [ -z "$(git -C "$CHECKOUT" status --porcelain)" ] || die "installation requires a clean checkout"
  current_tag=$(git -C "$CHECKOUT" describe --tags --exact-match HEAD 2>/dev/null || :)
  checkout_version=$(cat "$CHECKOUT/VERSION")
  if [ "$current_tag" != "v$checkout_version" ]; then
    install_phase release-selection
    origin=$(git -C "$CHECKOUT" config --get remote.origin.url)
    case $origin in
      https://github.com/*) repository=${origin#https://github.com/} ;;
      git@github.com:*) repository=${origin#git@github.com:} ;;
      *) die "published installation requires a GitHub origin" ;;
    esac
    repository=${repository%.git}
    printf '%s\n' "$repository" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || die "invalid GitHub repository"
    if command -v gh >/dev/null 2>&1 && gh auth status --hostname github.com >/dev/null 2>&1; then
      release_tag=$(gh api "repos/$repository/releases/latest" --jq .tag_name) || die "could not resolve the latest published release"
    else
      release_url=$(curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --max-time 60 --output /dev/null --write-out '%{url_effective}' "https://github.com/$repository/releases/latest") || die "could not resolve the latest release; private repositories require gh auth login"
      release_tag=${release_url##*/}
    fi
    printf '%s\n' "$release_tag" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || die "latest release has an unsupported tag"
    say "Selecting published release $release_tag; the cloned checkout will remain unchanged."
    install_event "event=selected-release tag=$release_tag"
    RELEASE_SOURCE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/pop-published-source.XXXXXX")
    GIT_TERMINAL_PROMPT=0 git clone --quiet --depth 1 --branch "$release_tag" -- "$origin" "$RELEASE_SOURCE_DIR/source" || die "could not fetch published release source"
    selected_commit=$(git -C "$RELEASE_SOURCE_DIR/source" rev-parse HEAD)
    tagged_commit=$(git -C "$RELEASE_SOURCE_DIR/source" rev-parse "refs/tags/$release_tag^{commit}") || die "published source tag is missing"
    [ "$selected_commit" = "$tagged_commit" ] || die "published source does not match the release tag"
    set -- --checkout "$RELEASE_SOURCE_DIR/source" --toolchain-dir "$TOOLCHAIN_DIR" --data-dir "$DATA_DIR" --workspace "$WORKSPACE" --port "$PORT"
    if [ "$INSTALL_APT" -eq 1 ]; then set -- "$@" --install-apt-packages; fi
    if [ "$NETWORK_ONBOARDING" -eq 0 ]; then set -- "$@" --skip-network-onboarding; fi
    sh "$RELEASE_SOURCE_DIR/source/deploy/bootstrap-server.sh" "$@"
    exit $?
  fi
fi

NODE_VERSION=
NODE_ARCHIVE=
NODE_SIZE=
NODE_SHA=
NODE_URL=
GO_VERSION=
GO_ARCHIVE=
GO_SIZE=
GO_SHA=
GO_URL=
WHISPER_VERSION=
WHISPER_ARCHIVE=
WHISPER_SIZE=
WHISPER_SHA=
WHISPER_URL=
NODE_MATCHES=0
GO_MATCHES=0
WHISPER_MATCHES=0
while IFS='|' read -r component version os architecture archive size sha url extra; do
  case $component in ''|'#'*) continue ;; esac
  [ -z "${extra:-}" ] || die "invalid extra field in toolchain manifest"
  if [ "$os" = linux ] && [ "$architecture" = "$ARCH" ]; then
    case $component in
      node)
        NODE_MATCHES=$((NODE_MATCHES + 1))
        NODE_VERSION=$version NODE_ARCHIVE=$archive NODE_SIZE=$size NODE_SHA=$sha NODE_URL=$url
        ;;
      go)
        GO_MATCHES=$((GO_MATCHES + 1))
        GO_VERSION=$version GO_ARCHIVE=$archive GO_SIZE=$size GO_SHA=$sha GO_URL=$url
        ;;
      whisper)
        WHISPER_MATCHES=$((WHISPER_MATCHES + 1))
        WHISPER_VERSION=$version WHISPER_ARCHIVE=$archive WHISPER_SIZE=$size WHISPER_SHA=$sha WHISPER_URL=$url
        ;;
    esac
  fi
done < "$MANIFEST"
[ "$NODE_MATCHES" -eq 1 ] || die "manifest must contain exactly one Node entry for linux-$ARCH"
[ "$GO_MATCHES" -eq 1 ] || die "manifest must contain exactly one Go entry for linux-$ARCH"
[ "$WHISPER_MATCHES" -eq 1 ] || die "manifest must contain exactly one whisper.cpp entry for linux-$ARCH"

mkdir -p -- "$TOOLCHAIN_DIR" "$TOOLCHAIN_DIR/downloads" "$TOOLCHAIN_DIR/runtimes" "$TOOLCHAIN_DIR/current"
chmod 700 "$TOOLCHAIN_DIR" "$TOOLCHAIN_DIR/downloads" "$TOOLCHAIN_DIR/runtimes" "$TOOLCHAIN_DIR/current"
TOOLCHAIN_DIR=$(CDPATH= cd -- "$TOOLCHAIN_DIR" && pwd -P)

verify_file() {
  file=$1
  expected_size=$2
  expected_sha=$3
  actual_size=$(wc -c < "$file" | tr -d ' ')
  [ "$actual_size" = "$expected_size" ] || return 1
  hash_line=$(sha256sum "$file") || return 1
  actual_sha=${hash_line%% *}
  [ "$actual_sha" = "$expected_sha" ]
}

download_archive() {
  archive=$1
  size=$2
  sha=$3
  url=$4
  destination=$TOOLCHAIN_DIR/downloads/$archive
  if [ -f "$destination" ] && verify_file "$destination" "$size" "$sha"; then
    say "Using verified cached archive $archive."
    DOWNLOADED_ARCHIVE=$destination
    return
  fi
  rm -f -- "$destination"
  temporary=$TOOLCHAIN_DIR/downloads/.$archive.$$
  rm -f -- "$temporary"
  say "Downloading pinned official archive $archive..."
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 --output "$temporary" "$url" \
    || { rm -f -- "$temporary"; die "download failed: $url"; }
  verify_file "$temporary" "$size" "$sha" \
    || { rm -f -- "$temporary"; die "downloaded archive failed pinned size/SHA-256 verification: $archive"; }
  mv -f -- "$temporary" "$destination"
  DOWNLOADED_ARCHIVE=$destination
}

validate_archive() {
  archive_path=$1
  compression=$2
  expected_root=$3
  listing=$STAGING_DIR/archive.list
  verbose=$STAGING_DIR/archive.verbose
  case $compression in
    xz)
      tar --quoting-style=literal -tJf "$archive_path" > "$listing" || die "cannot list archive: $archive_path"
      tar --quoting-style=literal -tvJf "$archive_path" > "$verbose" || die "cannot inspect archive: $archive_path"
      ;;
    gzip)
      tar --quoting-style=literal -tzf "$archive_path" > "$listing" || die "cannot list archive: $archive_path"
      tar --quoting-style=literal -tvzf "$archive_path" > "$verbose" || die "cannot inspect archive: $archive_path"
      ;;
    *) die "internal error: unsupported archive compression" ;;
  esac
  [ -s "$listing" ] || die "archive is empty: $archive_path"
  while IFS= read -r member; do
    case $member in
      "$expected_root"|"$expected_root/"|"$expected_root/"*) ;;
      *) die "archive has an unexpected root or unsafe path: $member" ;;
    esac
    case $member in
      /*|*\\*|../*|*/../*|*/..) die "archive contains an unsafe path: $member" ;;
    esac
  done < "$listing"
  while IFS= read -r verbose_line; do
    entry_type=${verbose_line%"${verbose_line#?}"}
    case $entry_type in -|d|l) ;; *) die "archive contains a hard link or special entry" ;; esac
  done < "$verbose"
}

runtime_is_verified() {
  component=$1
  runtime=$2
  version=$3
  sha=$4
  [ -d "$runtime" ] || return 1
  [ -f "$runtime/.pop-toolchain-release" ] || return 1
  grep -Fx "component=$component" "$runtime/.pop-toolchain-release" >/dev/null 2>&1 || return 1
  grep -Fx "version=$version" "$runtime/.pop-toolchain-release" >/dev/null 2>&1 || return 1
  grep -Fx "archive_sha256=$sha" "$runtime/.pop-toolchain-release" >/dev/null 2>&1 || return 1
  case $component in
    node)
      [ -x "$runtime/bin/node" ] && [ -x "$runtime/bin/npm" ] || return 1
      [ "$("$runtime/bin/node" --version 2>/dev/null)" = "v$version" ] || return 1
      PATH=$runtime/bin:$PATH "$runtime/bin/npm" --version >/dev/null 2>&1 || return 1
      ;;
    go)
      [ -x "$runtime/bin/go" ] || return 1
      go_output=$("$runtime/bin/go" version 2>/dev/null) || return 1
      case $go_output in "go version go$version linux/$ARCH") ;; *) return 1 ;; esac
      ;;
    whisper)
      [ -x "$runtime/whisper-cli" ] || return 1
      "$runtime/whisper-cli" --help >/dev/null 2>&1 || return 1
      ;;
    *) return 1 ;;
  esac
}

resolve_current_runtime() {
  component=$1
  version=$2
  sha=$3
  current=$TOOLCHAIN_DIR/current/$component
  [ ! -e "$current" ] || [ -L "$current" ] || die "managed current/$component is not a symlink; refusing to replace it"
  if [ -L "$current" ]; then
    resolved=$(CDPATH= cd -- "$current" 2>/dev/null && pwd -P) || return 1
    case $resolved in "$TOOLCHAIN_DIR/runtimes/"*) ;; *) die "managed current/$component points outside the toolchain" ;; esac
    if runtime_is_verified "$component" "$resolved" "$version" "$sha"; then
      ACTIVE_RUNTIME=$resolved
      return 0
    fi
  fi
  return 1
}

validate_extracted_tree() {
  root=$1
  special=$(find "$root" ! -type f ! -type d ! -type l -print -quit)
  [ -z "$special" ] || die "archive extracted a special filesystem entry: $special"
  if ! find "$root" -type l -print | while IFS= read -r link; do
    target=$(readlink -f -- "$link") || exit 1
    case $target in "$root"/*) ;; *) exit 1 ;; esac
  done; then
    die "archive contains a symlink escaping its runtime root"
  fi
}

install_runtime() {
  component=$1
  version=$2
  archive=$3
  size=$4
  sha=$5
  url=$6
  compression=$7
  expected_root=$8

  if resolve_current_runtime "$component" "$version" "$sha"; then
    say "Preserving verified $component $version runtime."
    return
  fi

  download_archive "$archive" "$size" "$sha" "$url"
  STAGING_DIR=$(mktemp -d "$TOOLCHAIN_DIR/runtimes/.staging-$component-XXXXXX")
  validate_archive "$DOWNLOADED_ARCHIVE" "$compression" "$expected_root"
  case $compression in
    xz) tar --no-same-owner --no-same-permissions -xJf "$DOWNLOADED_ARCHIVE" -C "$STAGING_DIR" ;;
    gzip) tar --no-same-owner --no-same-permissions -xzf "$DOWNLOADED_ARCHIVE" -C "$STAGING_DIR" ;;
  esac
  extracted=$STAGING_DIR/$expected_root
  [ -d "$extracted" ] || die "archive did not extract its declared root: $expected_root"
  validate_extracted_tree "$extracted"

  cat > "$extracted/.pop-toolchain-release" <<EOF
component=$component
version=$version
platform=linux
architecture=$ARCH
archive_sha256=$sha
EOF
  chmod 600 "$extracted/.pop-toolchain-release"
  runtime_is_verified "$component" "$extracted" "$version" "$sha" \
    || die "extracted $component $version runtime failed its executable smoke check"

  generation=$component-$version-$ARCH-$(date +%s)-$$
  activated=$TOOLCHAIN_DIR/runtimes/$generation
  mv -- "$extracted" "$activated"
  rm -rf -- "$STAGING_DIR"
  STAGING_DIR=
  temporary_link=$TOOLCHAIN_DIR/current/.$component.$$
  rm -f -- "$temporary_link"
  ln -s "../runtimes/$generation" "$temporary_link"
  # GNU mv -T replaces an existing symlink-to-directory instead of moving the
  # new link inside the old runtime. Ubuntu/Debian provide this through coreutils.
  mv -Tf -- "$temporary_link" "$TOOLCHAIN_DIR/current/$component"
  ACTIVE_RUNTIME=$activated
  say "Activated verified $component $version in the Pop-owned toolchain."
}

install_phase toolchain-download
# Independent downloads use separate subshell variables and temporary names.
download_archive "$NODE_ARCHIVE" "$NODE_SIZE" "$NODE_SHA" "$NODE_URL" &
node_download_pid=$!
download_archive "$WHISPER_ARCHIVE" "$WHISPER_SIZE" "$WHISPER_SHA" "$WHISPER_URL" &
whisper_download_pid=$!
node_download_status=0
wait "$node_download_pid" || node_download_status=$?
whisper_download_status=0
wait "$whisper_download_pid" || whisper_download_status=$?
node_download_pid=
whisper_download_pid=
[ "$node_download_status" -eq 0 ] && [ "$whisper_download_status" -eq 0 ] || die "toolchain download failed; verified archives are retained for retry"

install_phase toolchain-verification
install_runtime node "$NODE_VERSION" "$NODE_ARCHIVE" "$NODE_SIZE" "$NODE_SHA" "$NODE_URL" xz "node-v$NODE_VERSION-linux-$( [ "$ARCH" = amd64 ] && printf x64 || printf arm64 )"
ACTIVE_NODE=$ACTIVE_RUNTIME
ACTIVE_GO=
if [ "$BUILD_FROM_SOURCE" -eq 1 ]; then
  install_runtime go "$GO_VERSION" "$GO_ARCHIVE" "$GO_SIZE" "$GO_SHA" "$GO_URL" gzip go
  ACTIVE_GO=$ACTIVE_RUNTIME
fi
WHISPER_PLATFORM_ARCH=$( [ "$ARCH" = amd64 ] && printf x64 || printf arm64 )
install_runtime whisper "$WHISPER_VERSION" "$WHISPER_ARCHIVE" "$WHISPER_SIZE" "$WHISPER_SHA" "$WHISPER_URL" gzip "whisper-bin-ubuntu-$WHISPER_PLATFORM_ARCH"
ACTIVE_WHISPER=$ACTIVE_RUNTIME

PATH=$ACTIVE_NODE/bin:${ACTIVE_GO:+$ACTIVE_GO/bin:}$ACTIVE_WHISPER:$PATH
export PATH
[ "$(command -v node)" = "$ACTIVE_NODE/bin/node" ] || die "managed Node is not first on PATH"
[ "$(command -v whisper-cli)" = "$ACTIVE_WHISPER/whisper-cli" ] || die "managed whisper-cli is not first on PATH"

if [ "$BUILD_FROM_SOURCE" -eq 1 ]; then
  say "Managed toolchain ready: Node $NODE_VERSION, Go $GO_VERSION, and whisper.cpp $WHISPER_VERSION ($ARCH)."
else
  say "Managed runtime ready: Node $NODE_VERSION and whisper.cpp $WHISPER_VERSION ($ARCH); no Go or compiler required."
fi
if [ "$PREPARE_ONLY" -eq 1 ]; then
  say "Preparation complete; systemd installation was not invoked (--prepare-only)."
  exit 0
fi

cd -- "$CHECKOUT"
set -- --data-dir "$DATA_DIR" --workspace "$WORKSPACE" --port "$PORT"
if [ "$NETWORK_ONBOARDING" -eq 0 ]; then set -- "$@" --skip-network-onboarding; fi
if [ "$BUILD_FROM_SOURCE" -eq 1 ]; then
  say "Building from source with the complete development gate..."
  install_phase source-build
  npm run install:server -- "$@"
  exit $?
fi
say "Installing the prebuilt server release..."
install_phase prebuilt-runtime
node tools/install-prebuilt.ts "$@"
