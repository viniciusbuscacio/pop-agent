#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
GLOBAL_FILE=${POP_AGENT_VERSION_FILE:-}
if [ -z "$GLOBAL_FILE" ]; then
  printf 'POP_AGENT_VERSION_FILE is required and must point to the Pop Agent VERSION file.\n' >&2
  exit 1
fi
if [ ! -f "$GLOBAL_FILE" ]; then
  printf 'Global Pop Agent VERSION file not found: %s\n' "$GLOBAL_FILE" >&2
  exit 1
fi

GLOBAL_VERSION=$(tr -d '[:space:]' < "$GLOBAL_FILE")
LOCAL_VERSION=$(tr -d '[:space:]' < "$ROOT/VERSION")
if ! printf '%s\n' "$GLOBAL_VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  printf 'Invalid global Pop Agent version: %s\n' "$GLOBAL_VERSION" >&2
  exit 1
fi
if [ "$LOCAL_VERSION" != "$GLOBAL_VERSION" ]; then
  printf 'Desktop version %s does not match global Pop Agent version %s.\n' "$LOCAL_VERSION" "$GLOBAL_VERSION" >&2
  exit 1
fi
printf 'Global version alignment passed (%s)\n' "$GLOBAL_VERSION"
