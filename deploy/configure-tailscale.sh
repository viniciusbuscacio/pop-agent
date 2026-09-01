#!/bin/sh
set -eu

PROGRAM=${0##*/}
PORT=8787

say() { printf '%s\n' "$*"; }
die() { printf '%s: %s\n' "$PROGRAM" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Expose an already healthy, loopback-only Pop Agent server to your tailnet.

Usage:
  deploy/configure-tailscale.sh [--port PORT]

This helper does not install Tailscale, log in, change your tailnet account, or
make Pop Agent public on the internet. It configures Tailscale Serve only after
the local Pop Agent health check and the existing Tailscale session both pass.
EOF
}

while [ "$#" -gt 0 ]; do
  case $1 in
    --port)
      [ "$#" -ge 2 ] || die "--port requires a value"
      PORT=$2
      shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

case $PORT in ''|*[!0-9]*) die "port must be an integer from 1 to 65535: $PORT" ;; esac
[ "$PORT" -ge 1 ] 2>/dev/null && [ "$PORT" -le 65535 ] 2>/dev/null \
  || die "port must be an integer from 1 to 65535: $PORT"
[ "$(id -u)" -ne 0 ] || die "refusing to run as root; use the Pop Agent service owner"

command -v curl >/dev/null 2>&1 || die "required command not found: curl"
command -v tailscale >/dev/null 2>&1 || die "Tailscale is not installed; install and authenticate it first"

HEALTH_URL=http://127.0.0.1:$PORT/healthz
curl --fail --silent --show-error --max-time 5 "$HEALTH_URL" >/dev/null \
  || die "Pop Agent is not healthy at $HEALTH_URL"
tailscale status >/dev/null 2>&1 \
  || die "Tailscale is not authenticated or its daemon is unavailable; run 'tailscale status'"

say "Configuring tailnet-only HTTPS access for Pop Agent..."
tailscale serve --bg "http://127.0.0.1:$PORT"
say "Tailscale Serve is configured. Current status:"
tailscale serve status
say "Pop Agent remains bound to loopback; Tailscale owns the authenticated HTTPS edge."
