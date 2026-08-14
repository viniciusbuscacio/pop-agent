#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
"$ROOT/check-global-version.sh"
SETUP="$ROOT/build/bin/Pop Desktop Setup.app"
PACK="$ROOT/build/setup-pack"
VERSION=$(tr -d '[:space:]' < "$ROOT/VERSION")
ARCH=$(uname -m)
SIGNING_IDENTITY=${POP_MANAGER_CODESIGN_IDENTITY:-"aw-Local Code Signing"}

if [ "$ARCH" != "arm64" ]; then
  printf 'Pop Desktop Setup packaging requires arm64, got %s\n' "$ARCH" >&2
  exit 1
fi
if [ ! -d "$SETUP" ]; then
  printf 'Pop Desktop Setup.app is missing. Run build-setup-darwin.sh first.\n' >&2
  exit 1
fi
BUILT_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$SETUP/Contents/Info.plist")
if [ "$BUILT_VERSION" != "$VERSION" ]; then
  printf 'Built Setup is %s but VERSION is %s. Rebuild before packing.\n' "$BUILT_VERSION" "$VERSION" >&2
  exit 1
fi

FILE="pop-desktop-setup-$VERSION-darwin-$ARCH.dmg"
mkdir -p "$PACK"
if [ -e "$PACK/$FILE" ]; then
  printf 'Pop Desktop Setup %s is already packed; bump the version instead of overwriting release bytes.\n' "$VERSION" >&2
  exit 1
fi
VENV="$ROOT/build/dmg-venv"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install 'ds-store==1.3.1' 'mac-alias==2.2.2'
fi

trap 'rm -f "$PACK/$FILE" "$PACK/.setup-release.tmp"' EXIT
GOTOOLCHAIN=local go run github.com/viniciusbuscacio/go-installer/cmd/mkdmg@v0.4.0 \
  -layout setup -python "$VENV/bin/python" -app "$SETUP" \
  -volname "Pop Desktop Setup" -out "$PACK/$FILE"

if printf '%s' "$SIGNING_IDENTITY" | grep -q '^Developer ID Application:'; then
  if [ -z "${POP_NOTARY_PROFILE:-}" ]; then
    printf 'POP_NOTARY_PROFILE is required for a public Developer ID release.\n' >&2
    exit 1
  fi
  xcrun notarytool submit "$PACK/$FILE" --keychain-profile "$POP_NOTARY_PROFILE" --wait
  xcrun stapler staple "$PACK/$FILE"
fi

SHA256=$(shasum -a 256 "$PACK/$FILE" | awk '{print $1}')
SIZE=$(stat -f '%z' "$PACK/$FILE")
printf '{\n  "version": "%s",\n  "platform": "darwin",\n  "arch": "%s",\n  "file": "%s",\n  "sha256": "%s",\n  "size": %s\n}\n' \
  "$VERSION" "$ARCH" "$FILE" "$SHA256" "$SIZE" > "$PACK/.setup-release.tmp"
mv "$PACK/.setup-release.tmp" "$PACK/setup-release.json"
trap - EXIT
printf '%s\n' "$PACK/$FILE"
