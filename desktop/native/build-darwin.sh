#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
"$ROOT/check-global-version.sh"
DESKTOP_NAME="Pop Desktop"
DESKTOP_BUNDLE="$ROOT/build/bin/$DESKTOP_NAME.app"
SIGNING_IDENTITY=${POP_MANAGER_CODESIGN_IDENTITY:-"aw-Local Code Signing"}
VERSION=$(tr -d '[:space:]' < "$ROOT/VERSION")
ICON_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/pop-manager-icon.XXXXXX")
ICONSET="$ICON_ROOT/icon.iconset"
mkdir -p "$ICONSET"
trap 'rm -rf "$ICON_ROOT"' EXIT

for plist in "$ROOT/build/desktop/Info.plist"; do
  short=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")
  build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist")
  if [ "$short" != "$VERSION" ] || [ "$build" != "$VERSION" ]; then
    printf 'Version mismatch in %s (VERSION=%s, short=%s, build=%s)\n' "$plist" "$VERSION" "$short" "$build" >&2
    exit 1
  fi
done

if ! security find-identity -v -p codesigning | grep -F -q "\"$SIGNING_IDENTITY\""; then
  printf 'Code-signing identity not found: %s\n' "$SIGNING_IDENTITY" >&2
  printf 'Install the stable local identity or set POP_MANAGER_CODESIGN_IDENTITY.\n' >&2
  exit 1
fi

rm -rf "$ROOT/build/bin/Pop Desktop Manager.app" "$DESKTOP_BUNDLE"
mkdir -p "$DESKTOP_BUNDLE/Contents/MacOS" "$DESKTOP_BUNDLE/Contents/Helpers" "$DESKTOP_BUNDLE/Contents/Resources"

for spec in \
  "16 icon_16x16.png" \
  "32 icon_16x16@2x.png" \
  "32 icon_32x32.png" \
  "64 icon_32x32@2x.png" \
  "128 icon_128x128.png" \
  "256 icon_128x128@2x.png" \
  "256 icon_256x256.png" \
  "512 icon_256x256@2x.png" \
  "512 icon_512x512.png" \
  "1024 icon_512x512@2x.png"
do
  set -- $spec
  sips -z "$1" "$1" "$ROOT/build/appicon.png" --out "$ICONSET/$2" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$DESKTOP_BUNDLE/Contents/Resources/iconfile.icns"

CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o "$DESKTOP_BUNDLE/Contents/MacOS/$DESKTOP_NAME" ./cmd/pop-desktop
CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o "$DESKTOP_BUNDLE/Contents/Helpers/Pop Desktop Tray" .
(
  cd "$ROOT/../../launcher"
  CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$DESKTOP_BUNDLE/Contents/Helpers/pop" .
)
cp "$ROOT/build/desktop/Info.plist" "$DESKTOP_BUNDLE/Contents/Info.plist"

# Sign the nested helpers before sealing the outer bundle. Developer ID
# releases require Apple's trusted timestamp; local development identities do not.
sign() {
  if printf '%s' "$SIGNING_IDENTITY" | grep -q '^Developer ID Application:'; then
    codesign --force --timestamp --options runtime --sign "$SIGNING_IDENTITY" "$1" >/dev/null
  else
    codesign --force --timestamp=none --sign "$SIGNING_IDENTITY" "$1" >/dev/null
  fi
}
sign "$DESKTOP_BUNDLE/Contents/Helpers/Pop Desktop Tray"
sign "$DESKTOP_BUNDLE/Contents/Helpers/pop"
sign "$DESKTOP_BUNDLE"
codesign --verify --deep --strict "$DESKTOP_BUNDLE"

printf '%s\n' "$DESKTOP_BUNDLE"
