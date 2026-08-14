#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$ROOT/check-global-version.sh"
APP="$ROOT/build/bin/Pop Desktop.app"
PACK="$ROOT/build/desktop-pack"
VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")
SOURCE_VERSION=$(tr -d '[:space:]' < "$ROOT/VERSION")
if [ "$VERSION" != "$SOURCE_VERSION" ]; then
  printf 'Built Pop Desktop is %s but VERSION is %s. Rebuild before packing.\n' "$VERSION" "$SOURCE_VERSION" >&2
  exit 1
fi
ARCH=$(uname -m)
if [ "$ARCH" != "arm64" ]; then
  printf 'Pop Desktop MVP packaging requires arm64, got %s\n' "$ARCH" >&2
  exit 1
fi
FILE="pop-desktop-$VERSION-darwin-$ARCH.zip"
mkdir -p "$PACK"
if [ -e "$PACK/$FILE" ]; then
  printf 'Pop Desktop %s is already packed; bump its version instead of overwriting release bytes.\n' "$VERSION" >&2
  exit 1
fi
if [ -e "$PACK/release.json" ]; then
  EXISTING_VERSION=$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$PACK/release.json")
  if [ "$EXISTING_VERSION" = "$VERSION" ]; then
    printf 'Pop Desktop %s is already published; bump its version instead of overwriting release metadata.\n' "$VERSION" >&2
    exit 1
  fi
fi
MANIFEST_TMP="$PACK/.release-$VERSION.tmp"
(
  cd "$ROOT/build/bin"
  /usr/bin/zip -X -qry "$PACK/$FILE" "Pop Desktop.app"
)
trap 'rm -f "$PACK/$FILE" "$MANIFEST_TMP"' EXIT
SHA256=$(shasum -a 256 "$PACK/$FILE" | awk '{print $1}')
SIZE=$(stat -f '%z' "$PACK/$FILE")
printf '{\n  "version": "%s",\n  "platform": "darwin",\n  "arch": "%s",\n  "file": "%s",\n  "sha256": "%s",\n  "size": %s\n}\n' "$VERSION" "$ARCH" "$FILE" "$SHA256" "$SIZE" > "$MANIFEST_TMP"
mv "$MANIFEST_TMP" "$PACK/release.json"
trap - EXIT
printf '%s\n' "$PACK/$FILE"
