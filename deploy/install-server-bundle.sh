#!/bin/sh
set -eu

PROGRAM=${0##*/}
BUNDLE=
EXPECTED_SHA=
EXPECTED_COMMIT=
DESTINATION=
DATA_DIR=
WORKSPACE=
TOOLCHAIN_DIR=
PORT=8787
INSTALL_APT=0
PREPARE_ONLY=0
STAGING=
VERIFY_REPOSITORY=

say() { printf '%s\n' "$*"; }
die() { printf '%s: %s\n' "$PROGRAM" "$*" >&2; exit 1; }
cleanup() {
  [ -z "$STAGING" ] || rm -rf -- "$STAGING"
  [ -z "$VERIFY_REPOSITORY" ] || rm -rf -- "$VERIFY_REPOSITORY"
}
trap cleanup EXIT HUP INT TERM

usage() {
  cat <<'EOF'
Acquire a fixed Pop Agent commit from a verified local Git bundle.

Usage:
  install-server-bundle.sh \
    --bundle /absolute/pop-agent.bundle \
    --sha256 LOWERCASE_SHA256 \
    --commit LOWERCASE_GIT_COMMIT \
    --destination /absolute/checkout \
    --data-dir /absolute/data \
    --workspace /absolute/workspace [options]

Options:
  --toolchain-dir PATH         Override the private Node/Go/whisper.cpp toolchain directory
  --port PORT                  Server loopback port (default: 8787)
  --install-apt-packages       Install Git now and pass apt opt-in to the host bootstrap
  --prepare-only               Acquire source and prepare toolchain without systemd activation
  -h, --help                   Show this help

All source input is local. This command performs no HTTP requests.
EOF
}

require_value() {
  [ "$#" -ge 2 ] || die "$1 requires a value"
  case $2 in --*) die "$1 requires a value" ;; esac
}

while [ "$#" -gt 0 ]; do
  case $1 in
    --bundle) require_value "$@"; BUNDLE=$2; shift 2 ;;
    --sha256) require_value "$@"; EXPECTED_SHA=$2; shift 2 ;;
    --commit) require_value "$@"; EXPECTED_COMMIT=$2; shift 2 ;;
    --destination) require_value "$@"; DESTINATION=$2; shift 2 ;;
    --data-dir) require_value "$@"; DATA_DIR=$2; shift 2 ;;
    --workspace) require_value "$@"; WORKSPACE=$2; shift 2 ;;
    --toolchain-dir) require_value "$@"; TOOLCHAIN_DIR=$2; shift 2 ;;
    --port) require_value "$@"; PORT=$2; shift 2 ;;
    --install-apt-packages) INSTALL_APT=1; shift ;;
    --prepare-only) PREPARE_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

safe_absolute_path() {
  label=$1
  value=$2
  case $value in /*) ;; *) die "$label must be an absolute path: $value" ;; esac
  case $value in *[!A-Za-z0-9._+@/-]*|*%*) die "$label contains unsupported characters: $value" ;; esac
  case $value in */../*|*/..|*/./*|*/.) die "$label contains an unsafe path segment: $value" ;; esac
  [ "$value" != / ] || die "$label must not be the filesystem root"
}

for pair in "bundle:$BUNDLE" "destination:$DESTINATION" "data directory:$DATA_DIR" "workspace:$WORKSPACE"; do
  label=${pair%%:*}
  value=${pair#*:}
  [ -n "$value" ] || die "--${label%% *} is required"
  safe_absolute_path "$label" "$value"
done
if [ -n "$TOOLCHAIN_DIR" ]; then safe_absolute_path "toolchain directory" "$TOOLCHAIN_DIR"; fi
case $EXPECTED_SHA in *[!a-f0-9]*|'') die "SHA-256 must be 64 lowercase hexadecimal characters" ;; esac
[ "${#EXPECTED_SHA}" -eq 64 ] || die "SHA-256 must be 64 lowercase hexadecimal characters"
case $EXPECTED_COMMIT in *[!a-f0-9]*|'') die "commit must be a full lowercase hexadecimal Git commit" ;; esac
[ "${#EXPECTED_COMMIT}" -eq 40 ] || die "commit must be a full lowercase hexadecimal Git commit"
case $PORT in ''|*[!0-9]*) die "port must be an integer from 1 to 65535" ;; esac
[ "$PORT" -ge 1 ] 2>/dev/null && [ "$PORT" -le 65535 ] 2>/dev/null || die "port must be an integer from 1 to 65535"

[ "$(id -u)" -ne 0 ] || die "refusing to run as root"
[ "$(uname -s)" = Linux ] || die "only Ubuntu Linux is supported"
case $(uname -m) in x86_64|amd64|aarch64|arm64) ;; *) die "unsupported architecture" ;; esac
OS_RELEASE_FILE=${POP_AGENT_OS_RELEASE_FILE:-/etc/os-release}
[ -f "$OS_RELEASE_FILE" ] && [ -r "$OS_RELEASE_FILE" ] || die "cannot identify Linux distribution"
DIST_ID=
while IFS= read -r line; do
  case $line in ID=*) DIST_ID=${line#ID=}; DIST_ID=${DIST_ID#\"}; DIST_ID=${DIST_ID%\"}; break ;; esac
done < "$OS_RELEASE_FILE"
[ "$DIST_ID" = ubuntu ] || die "only Ubuntu is supported"

require_command() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }
if [ "$INSTALL_APT" -eq 1 ]; then
  require_command sudo
  require_command apt-get
  say "Installing the explicitly approved local-acquisition prerequisite (Git)..."
  sudo -- env DEBIAN_FRONTEND=noninteractive apt-get update
  sudo -- env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends git
fi
for command in git sha256sum mktemp mv; do require_command "$command"; done

[ -f "$BUNDLE" ] && [ ! -L "$BUNDLE" ] || die "bundle must be a regular local file, not a symlink: $BUNDLE"
[ ! -e "$DESTINATION" ] && [ ! -L "$DESTINATION" ] || die "destination already exists; refusing to overwrite it: $DESTINATION"
ACTUAL_SHA=$(sha256sum "$BUNDLE") || die "could not hash bundle"
ACTUAL_SHA=${ACTUAL_SHA%% *}
[ "$ACTUAL_SHA" = "$EXPECTED_SHA" ] || die "bundle SHA-256 mismatch"

PARENT=${DESTINATION%/*}
[ -n "$PARENT" ] || PARENT=/
mkdir -p -- "$PARENT"
PARENT=$(CDPATH= cd -- "$PARENT" && pwd -P)
DESTINATION=$PARENT/${DESTINATION##*/}
STAGING=$(mktemp -d "$PARENT/.staging-pop-agent-checkout-XXXXXX")
VERIFY_REPOSITORY=$(mktemp -d "$PARENT/.verify-pop-agent-bundle-XXXXXX")
git init --bare --quiet "$VERIFY_REPOSITORY" || die "could not create bundle verification repository"
git -C "$VERIFY_REPOSITORY" bundle verify "$BUNDLE" >/dev/null 2>&1 || die "git bundle verification failed"
rm -rf -- "$VERIFY_REPOSITORY"
VERIFY_REPOSITORY=

git clone --quiet --no-checkout -- "$BUNDLE" "$STAGING/checkout" || die "could not clone local bundle"
git -C "$STAGING/checkout" cat-file -e "$EXPECTED_COMMIT^{commit}" 2>/dev/null || die "expected commit is absent from bundle"
RESOLVED_COMMIT=$(git -C "$STAGING/checkout" rev-parse --verify "$EXPECTED_COMMIT^{commit}")
[ "$RESOLVED_COMMIT" = "$EXPECTED_COMMIT" ] || die "bundle commit does not match expected commit"
git -C "$STAGING/checkout" checkout --quiet --detach "$EXPECTED_COMMIT" || die "could not check out expected commit"
[ "$(git -C "$STAGING/checkout" rev-parse HEAD)" = "$EXPECTED_COMMIT" ] || die "checked-out commit mismatch"
[ -f "$STAGING/checkout/VERSION" ] && [ -f "$STAGING/checkout/package.json" ] \
  && [ -f "$STAGING/checkout/package-lock.json" ] && [ -x "$STAGING/checkout/deploy/bootstrap-server.sh" ] \
  || die "bundle is not a complete Pop Agent source release"
[ -z "$(git -C "$STAGING/checkout" status --porcelain=v1 --untracked-files=all)" ] || die "acquired checkout is not clean"

mv -- "$STAGING/checkout" "$DESTINATION"
rm -rf -- "$STAGING"
STAGING=
say "Acquired clean Pop Agent checkout at commit $EXPECTED_COMMIT."

set -- \
  --checkout "$DESTINATION" \
  --data-dir "$DATA_DIR" \
  --workspace "$WORKSPACE" \
  --port "$PORT"
if [ -n "$TOOLCHAIN_DIR" ]; then set -- "$@" --toolchain-dir "$TOOLCHAIN_DIR"; fi
if [ "$INSTALL_APT" -eq 1 ]; then set -- "$@" --install-apt-packages; fi
if [ "$PREPARE_ONLY" -eq 1 ]; then set -- "$@" --prepare-only; fi
exec "$DESTINATION/deploy/bootstrap-server.sh" "$@"
