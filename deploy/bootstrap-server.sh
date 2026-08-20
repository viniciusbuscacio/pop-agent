#!/bin/sh
set -eu

PROGRAM=${0##*/}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
MANIFEST=$SCRIPT_DIR/server-toolchain-manifest.tsv
CHECKOUT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
TOOLCHAIN_DIR=${XDG_DATA_HOME:-"$HOME/.local/share"}/pop-agent/server-toolchain
DATA_DIR=
WORKSPACE=
PORT=8787
INSTALL_APT=0
PREPARE_ONLY=0
STAGING_DIR=

say() {
  printf '%s\n' "$*"
}

die() {
  printf '%s: %s\n' "$PROGRAM" "$*" >&2
  exit 1
}

cleanup() {
  if [ -n "$STAGING_DIR" ] && [ -d "$STAGING_DIR" ]; then
    rm -rf -- "$STAGING_DIR"
  fi
}
trap cleanup EXIT HUP INT TERM

usage() {
  cat <<'EOF'
Prepare a supported Linux host for an existing Pop Agent checkout.

Usage:
  deploy/bootstrap-server.sh --data-dir /absolute/path --workspace /absolute/path [options]

Options:
  --checkout PATH              Existing Pop Agent checkout (default: script's repository)
  --toolchain-dir PATH         Pop-owned per-user runtime directory
  --data-dir PATH              Required server data directory
  --workspace PATH             Required server workspace directory
  --port PORT                  Server loopback port (default: 8787)
  --install-apt-packages       Explicitly allow the narrow apt prerequisite phase
  --prepare-only               Prepare and verify the toolchain without invoking systemd installation
  -h, --help                   Show this help

This is not a source, DNS, TLS, proxy, Tailscale, Caddy, or account installer.
It never pipes a remote script to a shell and never installs Node or Go system-wide.
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
    --prepare-only)
      PREPARE_ONLY=1
      shift
      ;;
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

[ -n "$DATA_DIR" ] || die "--data-dir is required"
[ -n "$WORKSPACE" ] || die "--workspace is required"
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
[ "$(uname -s)" = Linux ] || die "unsupported platform: only Ubuntu/Debian Linux is supported"
case $(uname -m) in
  x86_64|amd64) ARCH=amd64 ;;
  aarch64|arm64) ARCH=arm64 ;;
  *) die "unsupported architecture: $(uname -m); supported architectures are amd64 and arm64" ;;
esac

[ -r /etc/os-release ] || die "cannot identify the Linux distribution from /etc/os-release"
DIST_ID=
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
      break
      ;;
  esac
done < /etc/os-release
case $DIST_ID in
  ubuntu|debian) ;;
  *) die "unsupported Linux distribution '$DIST_ID'; only Ubuntu and Debian are supported" ;;
esac

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1 (rerun with --install-apt-packages where applicable)"
}

if [ "$INSTALL_APT" -eq 1 ]; then
  require_command sudo
  require_command apt-get
  say "Installing the explicitly approved apt prerequisites..."
  sudo -- env DEBIAN_FRONTEND=noninteractive apt-get update
  sudo -- env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl git xz-utils tar build-essential python3
fi

for required in curl git tar xz sha256sum find readlink mktemp mv; do
  require_command "$required"
done
if [ "$PREPARE_ONLY" -eq 0 ]; then
  require_command sudo
fi

[ -r "$MANIFEST" ] || die "pinned toolchain manifest is missing: $MANIFEST"
[ -d "$CHECKOUT" ] || die "checkout is not a directory: $CHECKOUT"
CHECKOUT=$(CDPATH= cd -- "$CHECKOUT" && pwd -P)
[ -f "$CHECKOUT/package.json" ] && [ -f "$CHECKOUT/package-lock.json" ] \
  || die "checkout is not an existing Pop Agent checkout: $CHECKOUT"

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
NODE_MATCHES=0
GO_MATCHES=0
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
    esac
  fi
done < "$MANIFEST"
[ "$NODE_MATCHES" -eq 1 ] || die "manifest must contain exactly one Node entry for linux-$ARCH"
[ "$GO_MATCHES" -eq 1 ] || die "manifest must contain exactly one Go entry for linux-$ARCH"

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

install_runtime node "$NODE_VERSION" "$NODE_ARCHIVE" "$NODE_SIZE" "$NODE_SHA" "$NODE_URL" xz "node-v$NODE_VERSION-linux-$( [ "$ARCH" = amd64 ] && printf x64 || printf arm64 )"
ACTIVE_NODE=$ACTIVE_RUNTIME
install_runtime go "$GO_VERSION" "$GO_ARCHIVE" "$GO_SIZE" "$GO_SHA" "$GO_URL" gzip go
ACTIVE_GO=$ACTIVE_RUNTIME

PATH=$ACTIVE_NODE/bin:$ACTIVE_GO/bin:$PATH
export PATH
[ "$(command -v node)" = "$ACTIVE_NODE/bin/node" ] || die "managed Node is not first on PATH"
[ "$(command -v npm)" = "$ACTIVE_NODE/bin/npm" ] || die "managed npm is not first on PATH"
[ "$(command -v go)" = "$ACTIVE_GO/bin/go" ] || die "managed Go is not first on PATH"

say "Managed toolchain ready: Node $NODE_VERSION and Go $GO_VERSION ($ARCH)."
if [ "$PREPARE_ONLY" -eq 1 ]; then
  say "Preparation complete; systemd installation was not invoked (--prepare-only)."
  exit 0
fi

say "Handing off to the delivered prepared-checkout installer..."
cd -- "$CHECKOUT"
exec npm run install:server -- --data-dir "$DATA_DIR" --workspace "$WORKSPACE" --port "$PORT"
