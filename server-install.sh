#!/bin/sh
set -eu

PROGRAM=server-install.sh
REPOSITORY=viniciusbuscacio/pop-agent
REF=main
DESTINATION=$HOME/pop-agent
DATA_DIR=$HOME/.pop-agent
WORKSPACE=$HOME/pop-agent-workspace
PORT=8787
INSTALL_APT=1
PREPARE_ONLY=0
STAGING=
INVOKING_UID=
PARENT=
RESOLVED_COMMIT=

say() { printf '%s\n' "$*"; }
die() { printf '%s: %s\n' "$PROGRAM" "$*" >&2; exit 1; }
cleanup() { [ -z "$STAGING" ] || rm -rf -- "$STAGING"; }
on_signal() {
  trap - EXIT HUP INT TERM
  cleanup
  exit 1
}
trap cleanup EXIT
trap on_signal HUP INT TERM

usage() {
  cat <<'EOF'
Acquire and install Pop Agent from GitHub.

Usage:
  server-install.sh [options]

Options:
  --repo OWNER/REPO            GitHub repository (default: viniciusbuscacio/pop-agent)
  --ref REF                    Branch, tag, or full commit (default: main)
  --destination PATH           New checkout path (default: $HOME/pop-agent)
  --data-dir PATH              Server data path (default: $HOME/.pop-agent)
  --workspace PATH             Server workspace path (default: $HOME/pop-agent-workspace)
  --port PORT                  Server loopback port (default: 8787)
  --prepare-only               Acquire source and prepare the toolchain without systemd activation
  --no-install-apt-packages    Do not opt in to the bootstrap's fixed apt prerequisite allowlist
  -h, --help                   Show this help

Public repositories require only Git and are acquired over non-interactive
HTTPS. An authenticated GitHub CLI session is optional and enables private or
access-controlled repositories and forks. Neither path accepts a token argument
or puts credentials in source URLs. The destination must not already exist. The
script does not configure DNS, TLS, a firewall, proxy, tunnel, or Pop account.
EOF
}

require_value() {
  [ "$#" -ge 2 ] || die "$1 requires a value"
  case $2 in --*) die "$1 requires a value" ;; esac
}

while [ "$#" -gt 0 ]; do
  case $1 in
    --repo) require_value "$@"; REPOSITORY=$2; shift 2 ;;
    --ref) require_value "$@"; REF=$2; shift 2 ;;
    --destination) require_value "$@"; DESTINATION=$2; shift 2 ;;
    --data-dir) require_value "$@"; DATA_DIR=$2; shift 2 ;;
    --workspace) require_value "$@"; WORKSPACE=$2; shift 2 ;;
    --port) require_value "$@"; PORT=$2; shift 2 ;;
    --prepare-only) PREPARE_ONLY=1; shift ;;
    --no-install-apt-packages) INSTALL_APT=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

safe_absolute_path() {
  label=$1
  value=$2
  case $value in /*) ;; *) die "$label must be an absolute path: $value" ;; esac
  case $value in
    *[!A-Za-z0-9._+@/-]*|*%*) die "$label contains unsupported characters: $value" ;;
  esac
  case $value in
    /|*/../*|*/..|*/./*|*/.|*/) die "$label contains an unsafe path: $value" ;;
  esac
}

paths_overlap() {
  first=$1
  second=$2
  [ "$first" = "$second" ] || [ "${second#"$first"/}" != "$second" ] || [ "${first#"$second"/}" != "$first" ]
}

validate_paths() {
  safe_absolute_path "destination" "$DESTINATION"
  safe_absolute_path "data directory" "$DATA_DIR"
  safe_absolute_path "workspace" "$WORKSPACE"
  if paths_overlap "$DESTINATION" "$DATA_DIR" || paths_overlap "$DESTINATION" "$WORKSPACE"; then
    die "data and workspace paths must be outside the replaceable checkout"
  fi
  if paths_overlap "$DATA_DIR" "$WORKSPACE"; then
    die "data directory and workspace must be separate, non-overlapping paths"
  fi
}

validate_paths
safe_absolute_path "home directory" "$HOME"
case $PORT in ''|*[!0-9]*) die "port must be an integer from 1 to 65535: $PORT" ;; esac
[ "$PORT" -ge 1 ] 2>/dev/null && [ "$PORT" -le 65535 ] 2>/dev/null \
  || die "port must be an integer from 1 to 65535: $PORT"

OWNER=${REPOSITORY%%/*}
NAME=${REPOSITORY#*/}
[ -n "$OWNER" ] && [ -n "$NAME" ] && [ "$NAME" != "$REPOSITORY" ] || die "repo must be OWNER/REPO"
case $OWNER in -*|*[!A-Za-z0-9-]*|-) die "repo must be a safe GitHub OWNER/REPO" ;; esac
case $NAME in -*|*/*|*[!A-Za-z0-9._-]*|.|..|'') die "repo must be a safe GitHub OWNER/REPO" ;; esac
case $REF in
  ''|-*|/*|*/|*//*|*..*|*[!A-Za-z0-9._/-]*) die "ref contains unsupported or unsafe characters" ;;
esac

INVOKING_UID=$(id -u)
[ "$INVOKING_UID" -ne 0 ] || die "refusing to run as root; run as the non-root service owner"
[ "$(uname -s)" = Linux ] || die "unsupported platform: only Ubuntu/Debian Linux is supported"
case $(uname -m) in
  x86_64|amd64|aarch64|arm64) ;;
  *) die "unsupported architecture: $(uname -m); supported architectures are amd64 and arm64" ;;
esac
[ -r /etc/os-release ] || die "cannot identify the Linux distribution from /etc/os-release"
DIST_ID=
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

require_command() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }
for required in git mktemp mkdir mv realpath rm stat chmod env; do require_command "$required"; done
GIT_EXECUTABLE=$(realpath -- "$(command -v git)") || die "could not resolve Git executable"
[ -f "$GIT_EXECUTABLE" ] && [ -x "$GIT_EXECUTABLE" ] || die "Git executable is not a regular executable file"

DESTINATION=$(realpath -m -- "$DESTINATION") || die "could not resolve destination path"
DATA_DIR=$(realpath -m -- "$DATA_DIR") || die "could not resolve data directory path"
WORKSPACE=$(realpath -m -- "$WORKSPACE") || die "could not resolve workspace path"
validate_paths
[ ! -e "$DESTINATION" ] && [ ! -L "$DESTINATION" ] \
  || die "destination already exists; this acquisition command refuses to overwrite or reuse it: $DESTINATION"

assert_secure_parent() {
  [ -d "$PARENT" ] && [ ! -L "$PARENT" ] || die "destination parent must be a real directory: $PARENT"
  current_parent=$(CDPATH= cd -- "$PARENT" && pwd -P) || die "could not revalidate destination parent"
  [ "$current_parent" = "$PARENT" ] || die "destination parent changed during acquisition: $PARENT"
  parent_owner=$(stat -c %u -- "$PARENT") || die "could not read destination parent ownership"
  [ "$parent_owner" = "$INVOKING_UID" ] \
    || die "destination parent must be owned by invoking uid $INVOKING_UID: $PARENT"

  checked=$PARENT
  while :; do
    checked_owner=$(stat -c %u -- "$checked") || die "could not read destination ancestor ownership: $checked"
    [ "$checked_owner" = "$INVOKING_UID" ] || [ "$checked_owner" = 0 ] \
      || die "destination ancestors must be owned by root or invoking uid $INVOKING_UID: $checked"
    checked_mode=$(stat -c %a -- "$checked") || die "could not read destination ancestor permissions: $checked"
    case $checked_mode in ''|*[!0-7]*) die "could not validate destination ancestor permissions: $checked" ;; esac
    if [ $((0$checked_mode & 022)) -ne 0 ]; then
      [ "$checked_owner" = 0 ] && [ $((0$checked_mode & 01000)) -ne 0 ] \
        || die "destination ancestors must not be group- or world-writable unless root-owned and sticky: $checked"
    fi
    [ "$checked" = / ] && break
    checked=${checked%/*}
    [ -n "$checked" ] || checked=/
  done
}

PARENT=${DESTINATION%/*}
[ -n "$PARENT" ] || PARENT=/
(umask 077 && mkdir -p -- "$PARENT") || die "could not create destination parent: $PARENT"
PARENT=$(CDPATH= cd -- "$PARENT" && pwd -P) || die "could not resolve destination parent"
DESTINATION=$PARENT/${DESTINATION##*/}
assert_secure_parent
[ ! -e "$DESTINATION" ] && [ ! -L "$DESTINATION" ] \
  || die "destination already exists; this acquisition command refuses to overwrite or reuse it: $DESTINATION"
STAGING=$(umask 077 && mktemp -d "$PARENT/.staging-pop-agent-github-XXXXXX") \
  || die "could not create owner-only source staging"
chmod 700 -- "$STAGING" || die "could not secure source staging"
STAGING_MODE=$(stat -c %a -- "$STAGING") || die "could not validate source staging permissions"
STAGING_OWNER=$(stat -c %u -- "$STAGING") || die "could not validate source staging ownership"
[ "$STAGING_OWNER" = "$INVOKING_UID" ] && [ $((0$STAGING_MODE & 077)) -eq 0 ] \
  || die "source staging is not owner-only"

CLEAN_GIT_HOME=$STAGING/clean-git-home
(umask 077 && mkdir -- "$CLEAN_GIT_HOME") || die "could not create isolated Git validation home"

clean_git() {
  env -i HOME="$CLEAN_GIT_HOME" PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=C.UTF-8 GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never \
    "$GIT_EXECUTABLE" -c credential.helper= -c core.askPass= -c core.hooksPath=/dev/null "$@"
}

resolve_cloned_ref() {
  checkout=$1
  branch_ref=refs/remotes/origin/$REF
  tag_ref=refs/tags/$REF
  branch_exists=0
  tag_exists=0
  clean_git -C "$checkout" show-ref --verify --quiet "$branch_ref" && branch_exists=1
  clean_git -C "$checkout" show-ref --verify --quiet "$tag_ref" && tag_exists=1
  if [ "$branch_exists" -eq 1 ] && [ "$tag_exists" -eq 1 ]; then
    die "ref '$REF' is ambiguous: both a branch and tag exist; use a full commit or remove the ambiguity"
  elif [ "$branch_exists" -eq 1 ]; then
    candidate=$branch_ref
  elif [ "$tag_exists" -eq 1 ]; then
    candidate=$tag_ref
  else
    case $REF in
      [a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9]) candidate=$REF ;;
      *) return 1 ;;
    esac
  fi
  clean_git -C "$checkout" rev-parse --verify "$candidate^{commit}" 2>/dev/null
}

AUTHENTICATED_GH=0
if command -v gh >/dev/null 2>&1 && gh auth status --hostname github.com >/dev/null 2>&1; then
  AUTHENTICATED_GH=1
fi
# Environment-injected Git config must not alter either acquisition path.
unset GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS

if [ "$AUTHENTICATED_GH" -eq 1 ]; then
  say "Cloning $REPOSITORY through authenticated GitHub CLI..."
  gh repo clone "$REPOSITORY" "$STAGING/checkout" -- --no-checkout --quiet \
    || die "authenticated repository clone failed; verify 'gh auth status' and repository access"
else
  say "Cloning $REPOSITORY over public HTTPS Git..."
  PUBLIC_GIT_HOME=$STAGING/public-git-home
  (umask 077 && mkdir -- "$PUBLIC_GIT_HOME") || die "could not create isolated public Git home"
  (
    unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN
    unset GIT_ASKPASS SSH_ASKPASS SSH_ASKPASS_REQUIRE SSH_AUTH_SOCK SSH_AGENT_PID
    unset GIT_SSH GIT_SSH_COMMAND GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
    unset GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM XDG_CONFIG_HOME
    HOME=$PUBLIC_GIT_HOME GIT_CONFIG_NOSYSTEM=1 GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=Never \
      git -c credential.helper= -c core.askPass= clone --quiet --no-checkout -- \
      "https://github.com/$REPOSITORY.git" "$STAGING/checkout"
  ) || die "public HTTPS clone failed without interactive credentials; verify repository access, or for a private/access-controlled repository install GitHub CLI, run 'gh auth login', and retry"
fi

RESOLVED_COMMIT=$(resolve_cloned_ref "$STAGING/checkout") \
  || die "requested ref is not a cloned branch, tag, or available full commit: $REF"
case $RESOLVED_COMMIT in *[!a-f0-9]*|'') die "Git did not resolve one full commit for ref: $REF" ;; esac
[ "${#RESOLVED_COMMIT}" -eq 40 ] || die "Git did not resolve one full commit for ref: $REF"

if [ "$AUTHENTICATED_GH" -eq 1 ]; then
  say "Confirming exact commit $RESOLVED_COMMIT through authenticated GitHub API..."
  API_COMMIT=$(gh api --hostname github.com --method GET \
    -H "Accept: application/vnd.github+json" \
    "repos/$REPOSITORY/commits/$RESOLVED_COMMIT" --jq .sha) \
    || die "authenticated GitHub API could not confirm cloned commit $RESOLVED_COMMIT"
  [ "$API_COMMIT" = "$RESOLVED_COMMIT" ] \
    || die "authenticated GitHub API returned a different commit than the clone"
fi

clean_git -C "$STAGING/checkout" checkout --quiet --detach "$RESOLVED_COMMIT" \
  || die "could not check out resolved commit $RESOLVED_COMMIT"

validate_checkout() {
  checkout=$1
  expected=$2
  context=$3
  [ -d "$checkout/.git" ] && [ ! -L "$checkout/.git" ] \
    || die "$context is not a Git checkout"
  for required_file in VERSION package.json package-lock.json deploy/bootstrap-server.sh deploy/server-toolchain-manifest.tsv; do
    required_path=$checkout/$required_file
    [ -f "$required_path" ] && [ ! -L "$required_path" ] \
      || die "$context required file must be regular and not a symlink: $required_file"
  done
  [ -x "$checkout/deploy/bootstrap-server.sh" ] \
    || die "$context bootstrap is not executable"
  canonical_checkout=$(CDPATH= cd -- "$checkout" && pwd -P) \
    || die "$context path cannot be resolved"
  canonical_bootstrap=$(realpath -- "$checkout/deploy/bootstrap-server.sh") \
    || die "$context bootstrap path cannot be resolved"
  [ "$canonical_bootstrap" = "$canonical_checkout/deploy/bootstrap-server.sh" ] \
    || die "$context bootstrap path escapes the checkout"
  actual_commit=$(clean_git -C "$checkout" rev-parse --verify HEAD) \
    || die "$context commit cannot be read"
  [ "$actual_commit" = "$expected" ] || die "$context commit does not match $expected"
  [ -z "$(clean_git -C "$checkout" status --porcelain=v1 --untracked-files=all --ignore-submodules=none)" ] \
    || die "$context is not clean"
}

validate_checkout "$STAGING/checkout" "$RESOLVED_COMMIT" "acquired checkout"
assert_secure_parent
[ ! -e "$DESTINATION" ] && [ ! -L "$DESTINATION" ] \
  || die "destination appeared during acquisition; refusing activation: $DESTINATION"
mv -T -n -- "$STAGING/checkout" "$DESTINATION" \
  || die "could not atomically activate the acquired checkout"
[ ! -e "$STAGING/checkout" ] \
  || die "destination appeared during activation; the acquired checkout was not activated"
rm -rf -- "$STAGING"
STAGING=

ACTIVATED_CHECKOUT=$(CDPATH= cd -- "$DESTINATION" && pwd -P) \
  || die "activated checkout cannot be resolved"
[ "$ACTIVATED_CHECKOUT" = "$DESTINATION" ] \
  || die "activated checkout path was substituted during activation"
validate_checkout "$ACTIVATED_CHECKOUT" "$RESOLVED_COMMIT" "activated checkout"
BOOTSTRAP=$(realpath -- "$ACTIVATED_CHECKOUT/deploy/bootstrap-server.sh") \
  || die "activated bootstrap path cannot be resolved"
[ "$BOOTSTRAP" = "$ACTIVATED_CHECKOUT/deploy/bootstrap-server.sh" ] \
  || die "activated bootstrap path escapes the checkout"
say "Acquired clean Pop Agent checkout at exact commit $RESOLVED_COMMIT."

# Build/service setup receives a small deliberate environment rather than
# inherited token, askpass, SSH-agent, or environment-injected Git config.
SERVICE_USER=$(id -un) || die "could not determine service user"
case $SERVICE_USER in ''|*[!A-Za-z0-9_-]*) die "service user contains unsupported characters" ;; esac
SAFE_HOME=$HOME
SAFE_PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SAFE_LANG=C.UTF-8

set -- \
  --checkout "$ACTIVATED_CHECKOUT" \
  --data-dir "$DATA_DIR" \
  --workspace "$WORKSPACE" \
  --port "$PORT"
if [ "$INSTALL_APT" -eq 1 ]; then set -- "$@" --install-apt-packages; fi
if [ "$PREPARE_ONLY" -eq 1 ]; then set -- "$@" --prepare-only; fi
say "Handing off to the acquired checkout's verified host bootstrap..."
if env -i HOME="$SAFE_HOME" USER="$SERVICE_USER" LOGNAME="$SERVICE_USER" \
  PATH="$SAFE_PATH" LANG="$SAFE_LANG" "$BOOTSTRAP" "$@"; then
  exit 0
else
  HANDOFF_STATUS=$?
  printf '%s: downstream bootstrap failed with status %s; the verified checkout was preserved.\n' \
    "$PROGRAM" "$HANDOFF_STATUS" >&2
  printf '%s\n' "The acquisition command refuses the existing destination. Retry exactly:" >&2
  printf "  env -i HOME='%s' USER='%s' LOGNAME='%s' PATH='%s' LANG='%s' '%s'" \
    "$SAFE_HOME" "$SERVICE_USER" "$SERVICE_USER" "$SAFE_PATH" "$SAFE_LANG" "$BOOTSTRAP" >&2
  for retry_arg in "$@"; do printf " '%s'" "$retry_arg" >&2; done
  printf '\n' >&2
  exit "$HANDOFF_STATUS"
fi
