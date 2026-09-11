# Windows Desktop and CLI components

Owner decision, 2026-09-11: keep the working Go installer and its Next/Finish
flow. The product names are **Pop Agent Desktop** and **Pop Agent CLI**. Both
start selected; either can be installed independently.

## Implementation

- Keep the existing go-installer/Wails setup and add a Components step.
- Reject no selection in JavaScript and Go. Existing components survive repairs
  and additive upgrades; unchecking is not an uninstall operation.
- Desktop uses the existing server UI in a Windows WebView2 process and starts
  the independently authorized computer-access tray. Closing its window leaves
  the tray running; Quit from the tray also closes the matching Desktop process.
- Keep the legacy installation directory/registration identity for upgrades,
  replacing its visible branding and shortcuts. Private launcher and optional
  terminal launcher have separate paths; only the terminal path is exported.
- Include component bytes, manifest and PATH changes in installation recovery.
  Removal preserves profiles, browser storage, shared caches and independent CLI
  installs. Source development builds default to a non-mutating preview.
- Desktop uses ordinary web login separately from setup's runtime/CLI login.
  No tokens are injected into the web view and no native tool bridge is bound.
  Navigation remains on the configured origin; external HTTPS uses the browser.

## Validation

- Windows: setup Go suite and vet; Desktop navigation and process tests and vet;
  native Windows builds of setup and the window/tray executable.
- Linux: complete tray/setup Go suites and vet, plus Windows cross-builds.
- Wizard: 12 Vitest tests, including all three selections, empty selection,
  cancellation, failure, Finish choices, saved login and themes.
- Rendered the Components page with Chromium at 680×560 in both family themes
  and visually inspected the resulting images.
- Specification index and generated self-map checks.

The pre-existing complete tray suite on Windows fails
`TestSaveLoginPreservesOtherProfilesAndPermissions`: its POSIX owner-only mode
assertion is not portable to Windows. The same suite passes on Linux. This is
not evidence that Windows ACL behavior was validated by that test.

Actual clean-user installation, upgrade/uninstall, window focus/lifecycle,
downloads, microphone, passkeys and notification behavior still need Windows
device acceptance before publishing a supported release. No production install,
version bump or GitHub publication is part of this development change.

Ubuntu validation uses a dedicated directory under the user's disk-backed
cache as TMPDIR. `/tmp` is a small tmpfs with user quotas and is unsuitable for
simultaneous dependency extraction and cross-build outputs on this host.
