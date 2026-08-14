#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$ROOT"
"$ROOT/check-global-version.sh"
SETUP_NAME="Pop Desktop Setup"
SETUP_BUNDLE="$ROOT/build/bin/$SETUP_NAME.app"
DESKTOP_BUNDLE="$ROOT/build/bin/Pop Desktop.app"
SIGNING_IDENTITY=${POP_MANAGER_CODESIGN_IDENTITY:-"aw-Local Code Signing"}
VERSION=$(tr -d '[:space:]' < "$ROOT/VERSION")

if [ ! -d "$DESKTOP_BUNDLE" ]; then
  printf 'Pop Desktop.app is missing. Run build-darwin.sh first.\n' >&2
  exit 1
fi
DESKTOP_VERSION=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$DESKTOP_BUNDLE/Contents/Info.plist")
if [ "$DESKTOP_VERSION" != "$VERSION" ]; then
  printf 'Pop Desktop payload is %s but Setup is %s. Rebuild Pop Desktop first.\n' "$DESKTOP_VERSION" "$VERSION" >&2
  exit 1
fi
for plist in "$ROOT/build/setup/Info.plist"; do
  short=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$plist")
  build=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$plist")
  if [ "$short" != "$VERSION" ] || [ "$build" != "$VERSION" ]; then
    printf 'Version mismatch in %s (VERSION=%s, short=%s, build=%s)\n' "$plist" "$VERSION" "$short" "$build" >&2
    exit 1
  fi
done
if ! security find-identity -v -p codesigning | grep -F -q "\"$SIGNING_IDENTITY\""; then
  printf 'Code-signing identity not found: %s\n' "$SIGNING_IDENTITY" >&2
  exit 1
fi

rm -rf "$SETUP_BUNDLE"
mkdir -p "$SETUP_BUNDLE/Contents/MacOS" "$SETUP_BUNDLE/Contents/Resources"
CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o "$SETUP_BUNDLE/Contents/MacOS/$SETUP_NAME" ./cmd/pop-desktop-setup
cp "$ROOT/build/setup/Info.plist" "$SETUP_BUNDLE/Contents/Info.plist"
cp "$DESKTOP_BUNDLE/Contents/Resources/iconfile.icns" "$SETUP_BUNDLE/Contents/Resources/iconfile.icns"
/usr/bin/ditto "$DESKTOP_BUNDLE" "$SETUP_BUNDLE/Contents/Resources/Pop Desktop.app"

if printf '%s' "$SIGNING_IDENTITY" | grep -q '^Developer ID Application:'; then
  codesign --force --timestamp --options runtime --sign "$SIGNING_IDENTITY" "$SETUP_BUNDLE" >/dev/null
else
  codesign --force --timestamp=none --sign "$SIGNING_IDENTITY" "$SETUP_BUNDLE" >/dev/null
fi
codesign --verify --deep --strict "$SETUP_BUNDLE"
printf '%s\n' "$SETUP_BUNDLE"
