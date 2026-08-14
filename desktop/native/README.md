# Pop Desktop

Pop Desktop is the native macOS client for a self-hosted Pop Agent server. One installed application contains the WKWebView process and an internal `Pop Desktop Tray` helper for menu-bar controls, server configuration, diagnostics, updates, and runtime supervision.

The React interface remains server-owned and is loaded directly from the configured HTTPS origin. Pop Desktop does not bundle Chromium, Node, a second frontend, or a second agent.

Current scope:

- one installed `Pop Desktop.app` product containing two coupled processes;
- WKWebView window with persistent web storage;
- internal `Pop Desktop Tray` helper with native menu-bar status;
- closing Desktop terminates Tray, and quitting Tray terminates Desktop;
- native server-configuration and diagnostics dialogs;
- normalized Pop Agent URL and password login;
- session token stored in macOS Keychain, with migration from the former Manager services;
- sliding session renewal and Connected/Offline/Authentication required states;
- local Node and Pop CLI detection across common macOS installations;
- Pop Desktop-owned supervision of the CLI's hidden Pop Local Access mode, using the PWA session;
- a same-origin session bridge with no filesystem or command API exposed to web content;
- same-origin navigation confinement, native downloads, media prompts, and external links delegated to the default application;
- native Start at Login integration;
- single-instance enforcement, including exclusion of the former standalone Manager during migration.

## Development

Requirements: Go 1.23+, Xcode command-line tools, macOS Apple Silicon, and the stable `aw-Local Code Signing` identity in the login Keychain. A different stable identity can be selected with `POP_MANAGER_CODESIGN_IDENTITY`; ad-hoc signing is intentionally unsupported because its changing designated requirement makes macOS request Keychain authorization after every rebuild.

Pop Agent's root `VERSION` file is the global version source. Every build and package must receive its path; a missing file or mismatch stops the build before compilation:

```bash
export POP_AGENT_VERSION_FILE=/path/to/pop-agent/VERSION
make gate
# Create release bytes explicitly; an existing version is never overwritten:
make pack-desktop
# Or, with another installed identity:
POP_MANAGER_CODESIGN_IDENTITY="Apple Development: Name (TEAMID)" make gate
```

The first build signed by a new identity requests Keychain authorization once. Choose **Always Allow**; later builds signed by the same identity keep that approval.

Generated artifacts:

```text
build/bin/Pop Desktop.app
# Created only by `make pack-desktop`:
build/desktop-pack/pop-desktop-0.2.21-darwin-arm64.zip
build/desktop-pack/release.json
```

Architecture decisions are documented under [`docs/`](docs/).
