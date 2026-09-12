#!/usr/bin/env bash
# Presentation only: the original installer remains responsible for every operation.
set -uo pipefail
umask 077
entry=$1
shift
verbose=${POP_AGENT_INSTALL_VERBOSE:-0}
arguments=()
needs_sudo=1
prepare=0
apt=0
[[ "${entry##*/}" != server-install.sh ]] || apt=1
for argument in "$@"; do
  case "$argument" in
    --verbose) verbose=1 ;;
    *) arguments+=("$argument") ;;
  esac
  [[ "$argument" != --prepare-only ]] || prepare=1
  [[ "$argument" != --install-apt-packages ]] || apt=1
  [[ "$argument" != --no-install-apt-packages ]] || apt=0
done
if [[ $prepare = 1 && $apt = 0 ]]; then needs_sudo=0; fi

# Authenticate before reading keys. All later sudo calls fail noninteractively if
# credentials expire, rather than letting the D listener consume a password.
real_sudo=$(command -v sudo || true)
if [[ $needs_sudo = 1 && -n "$real_sudo" ]]; then
  printf 'Administrator access is required to install Pop Agent.\n'
  "$real_sudo" -v || exit $?
fi
log_root=${XDG_STATE_HOME:-"$HOME/.local/state"}
[[ "$log_root" = /* ]] || { echo 'Installation log directory must be absolute.' >&2; exit 1; }
log_dir=$log_root/pop-agent/install-logs
mkdir -p -- "$log_dir" || exit 1
[[ ! -L "$log_dir" && $(stat -c %u "$log_dir") = $(id -u) && $(stat -c %a "$log_dir") = 700 ]] || {
  echo 'Installation log directory must be private and owned by this user.' >&2; exit 1;
}
log=$(mktemp "$log_dir/details-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.log") || exit 1
temporary=$(mktemp -d "${TMPDIR:-/tmp}/pop-install-console.XXXXXX") || exit 1
child=
terminal=
interactive=0
[[ -t 0 && -t 1 ]] && interactive=1
finish() {
  [[ -z "$terminal" ]] || stty "$terminal" < /dev/tty
  rm -rf -- "$temporary"
}
stop() {
  trap '' INT TERM HUP
  if [[ -n "$child" ]]; then
    kill -TERM -- "-$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  printf '\nInstallation interrupted.\nDetailed installation log: %s\n' "$log"
  printf 'event=interrupted exit_code=%s\n' "$1" >> "$log"
  exit "$1"
}
trap finish EXIT
trap 'stop 130' INT
trap 'stop 143' TERM
trap 'stop 129' HUP

if [[ -n "$real_sudo" ]]; then
  mkdir "$temporary/bin"
  cat > "$temporary/bin/sudo" <<'SHIM'
#!/bin/sh
exec "$POP_AGENT_REAL_SUDO" -n "$@"
SHIM
  chmod 700 "$temporary/bin/sudo"
  export POP_AGENT_REAL_SUDO="$real_sudo"
  export PATH="$temporary/bin:$PATH"
fi
export POP_AGENT_INSTALL_UI_ACTIVE=1
printf 'Installing Pop Agent…\n'
if [[ $interactive = 1 ]]; then
  printf 'Press D for detailed logs.\n\n'
  terminal=$(stty -g < /dev/tty)
  stty -echo -icanon min 0 time 0 < /dev/tty
else
  verbose=1
fi
printf '%s event=start\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$log"
mkfifo "$temporary/output"
# Job control gives the installer its own process group while retaining the
# controlling terminal needed by the existing sudo timestamp.
set -m
bash "$entry" "${arguments[@]}" > "$temporary/output" 2>&1 < /dev/null &
child=$!
exec 7< "$temporary/output"
step=
setup=0
last_error=
ticks=0
partial=
refresh_at=$SECONDS
stage() {
  [[ "$step" != "$1" ]] || return 0
  if [[ "$verbose" != 1 ]]; then
    printf '\r\033[K'
    [[ -z "$step" ]] || printf '✓ %s\n' "$step"
    printf '  %s…' "$1"
  fi
  step=$1
}
stage 'Checking system requirements'
while true; do
  line=
  if IFS= read -r -t 0.1 -u 7 line || { read_status=$?; [[ $read_status = 1 && -n "$partial$line" ]]; }; then
    line=$partial$line
    partial=
    # Authentication is never captured. Defense in depth for command errors and
    # setup output: redact secret-bearing lines and URL credentials/query strings.
    lower=${line,,}
    case "$lower" in
      *password*|*authorization*|*bearer*|*token*|*secret*|*api_key*|*api-key*|*api\ key*|*one-time\ setup\ code*|*recovery\ key*|*private\ key*|*popi_*|*ghp_*|*github_pat_*|*sk-*)
        logged='[sensitive output omitted]' ;;
      *)
        logged=$(printf '%s\n' "$line" | sed -E 's#(https?://)[^ /]*@#\1[redacted]@#g; s#(https?://[^ ?]+)\?[^ ]*#\1?[redacted]#g') ;;
    esac
    printf '%s\n' "$logged" >> "$log"
    case "$line" in
      '[pop-step] prerequisites'|'Checking the minimal apt prerequisites'*) stage 'Checking system requirements' ;;
      'Installing missing prerequisites:'*) stage 'Installing required packages' ;;
      '[pop-step] tailscale-install'|'Installing Tailscale;'*) stage 'Preparing private networking' ;;
      '[pop-step] release-selection'|'Selecting published release '*|'Selecting source for published release '*) stage 'Selecting the published version' ;;
      '[pop-step] toolchain-download'|'Downloading pinned official archive '*) stage 'Downloading the runtime' ;;
      '[pop-step] toolchain-verification'|'Activated verified '*|'Preserving verified '*) stage 'Preparing the runtime' ;;
      '[pop-step] prebuilt-runtime'|'Fetching verified server release '*) stage 'Downloading Pop Agent' ;;
      'Extracting production dependencies '*) stage 'Installing Pop Agent' ;;
      'Checking native libraries,'*|'smoke: starting '*) stage 'Verifying the installation' ;;
      'Installing the verified release as a systemd service '*|'Installing popman and '*) stage 'Starting Pop Agent' ;;
      'Building from source '*|'Running the mandatory repository gate '*) stage 'Building and testing Pop Agent' ;;
      'Continue the private-network setup in a browser:'*) setup=1 ;;
      'E: '*|'Error: '*|*'sudo: '*) last_error=$logged ;;
    esac
    if [[ "$verbose" = 1 ]]; then
      [[ "$line" = '[pop-step] '* ]] || printf '%s\n' "$line"
    elif [[ "$line" != '[pop-step] '* ]]; then
      case "$line" in
        'If Ubuntu is updating packages,'*|*'Waiting for cache lock:'*)
          if [[ "$step" != 'Waiting for system updates to finish' ]]; then
            stage 'Waiting for system updates to finish'
          fi ;;
        'Installation log: '*) ;; # Journal paths are retained in the detail log.
        'If the setup code expires,'*) ;; # Print the recovery command once below.
        *)
          if [[ $setup = 1 ]]; then printf '\r\033[K%s\n' "$line"; fi ;;
      esac
    fi
  else
    partial+=$line
    [[ $read_status -gt 128 ]] || break
  fi
  if [[ $interactive = 1 ]]; then
    key=
    if IFS= read -r -t 0 key < /dev/tty; then
      IFS= read -r -s -n 1 -t 0.01 key < /dev/tty || true
    fi
    if [[ "$key" = d || "$key" = D ]] && [[ $verbose != 1 ]]; then
      printf '\r\033[KDetailed logs enabled (earlier sensitive output is omitted).\n'
      cat "$log"
      verbose=1
    fi
  fi
  if [[ $needs_sudo = 1 && -n "$real_sudo" && $((SECONDS - refresh_at)) -ge 60 ]]; then
    "$real_sudo" -n -v >/dev/null 2>&1 || true
    refresh_at=$SECONDS
  fi
  ticks=$((ticks + 1))
  if [[ $verbose != 1 && $setup != 1 && $((ticks % 5)) = 0 ]]; then
    frames='|/-\'
    printf '\r\033[K%s %s…' "${frames:$((ticks / 5 % 4)):1}" "$step"
  fi
done
status=0
wait "$child" || status=$?
child=
printf '%s event=finish exit_code=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$status" >> "$log"
printf '\r\033[K'
if [[ $status = 0 ]]; then
  if [[ $prepare = 1 ]]; then printf '✓ Runtime preparation complete.\n';
  else printf '✓ Pop Agent installation complete.\n'; fi
else
  printf 'Installation failed while: %s (exit %s).\n' "$step" "$status"
  [[ -z "$last_error" ]] || printf '%s\n' "$last_error"
fi
printf '\nDetailed installation log: %s\n' "$log"
if [[ $setup = 1 ]]; then printf 'If the setup code expires, run: popman onboarding-code\n'; fi
exit "$status"
