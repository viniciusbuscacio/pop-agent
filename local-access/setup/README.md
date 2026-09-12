# Pop Agent Setup

Wails v2 setup backed by `go-installer/windows` v0.4.0. The wizard offers **Pop Agent Desktop** and **Pop Agent CLI**, both checked by default. Desktop includes a view-only WebView2 window and optional computer-access tray; CLI exposes `pop` in new terminals.

## Build and checks

`npm run local-access:check` runs the Go checks and cross-builds the Windows host. `tsx tools/pack-cli.ts` stages the matching tray and launcher plus their verified manifest and builds the complete setup executable. Generated payloads are ignored by Git. A source-only build refuses installation.

On Windows, run `go test -v ./...` here to also test ACL-protected profile replacement and registry rollback against uniquely named disposable fixtures. These tests do not install PLA or modify its real registry/startup entries.

The executable accepts `--preview` for a non-mutating UI preview. An unversioned development build opens this mode automatically. Preview does not read saved profiles, install, uninstall or change startup settings. Wails still creates its normal WebView2 application cache.

## Runtime contract

- Windows x64 with Microsoft Edge WebView2 available; install per user without elevation.
- Destination: the Windows LocalAppData known folder, `PopAgent/LocalAccess`.
- Private launcher: `PopAgent/LocalAccess/runtime/pop.exe`; optional terminal launcher: `PopAgent/LocalAccess/cli/pop.exe`. Existing standalone launchers remain untouched. Shared profiles retain their existing location.
- The owner confirms the HTTPS server origin (HTTP only on loopback). The browser download's Zone.Identifier may suggest an origin, but does not authorize it.
- Sign-in uses the Go HTTPS client and rejects redirects. Tokens are not handed to runtime subprocesses or returned to the frontend.
- The launcher prepares verified Node/CLI dependencies before PLA replacement. Cached dependencies may remain after a failed preparation. Proxy-only networks are not an accepted test target yet.
- Upgrades preserve existing profiles, machine identity, access permission and startup choice. They never enable local access automatically.
- On commit failure, previous program bytes and uninstall registration are restored. If recovery itself fails, backup program files remain in the reported `.prepare-*/backup` folder.
- Uninstall removes the dedicated component directory, its CLI PATH entry, shortcuts/registration/startup entry. Separately installed launchers, profiles, WebView data and shared runtimes remain.

## Release acceptance - still required

Compilation and fixture tests do not prove a real clean-machine installation. Before publishing a new immutable version:

1. Install in an isolated clean Windows user with no CLI or Node on PATH; verify the entire wizard, first connection and initially disabled access.
2. Update an existing installation and verify profile bytes/extra profiles, stable machine identity, access policy and startup preference.
3. Verify cancellation before install, a blocked network/preparation failure, a locked target/recovery failure and retry.
4. Exercise Finish and the registered uninstaller. Confirm shared CLI data survives and no helper/tray/Node process is orphaned.
5. Check both themes, Windows scaling, Explorer icon, WebView2 availability, signing and SmartScreen prompts. The package is not Authenticode-signed by this build.

Do not publish the development rebuild under an already released version URL. Do not use the owner's live installation as the clean-user fixture.


## macOS

The shared Wails wizard is built by tools/macos-setup.ts and included in the
native stage DMG. It supports Desktop/CLI installation and updates, keeping
profiles and independent PWA installations. Desktop uses WKWebView and a nested
background helper; the CLI component alone adds its owned path to zsh/bash login
profiles. The macOS platform files implement the transaction, migration and
uninstall behavior. Read Spec-Pop-Installation.md for destinations and acceptance.
