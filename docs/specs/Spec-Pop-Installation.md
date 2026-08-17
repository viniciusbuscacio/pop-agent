# Pop Agent — Installation and client updates

**Status:** current architecture explanation
**Normative source:** `pop-agent.spec` §§4, 14, 15, 17 and 18
**Primary code:** `launcher/`, `server/src/interface/http/cli-installer-routes.ts`, `web/src/routes/installation-section.tsx`, `web/src/services/pwa-install.ts`, `local-access/`

## Product model

Pop Agent has separate installable concerns:

1. the server, normally deployed on Linux;
2. the browser-installed PWA;
3. the native `pop` launcher and TypeScript CLI;
4. optional Pop Local Access tray/runtime on a user's computer.

There is no native Pop Desktop WebView product. The installed app experience is the PWA; local computer access is optional and separate.

## PWA

Settings → Installation exposes the browser-native PWA install prompt when Chromium supplies `beforeinstallprompt`. The browser owns final confirmation. Safari and iOS receive manual Add to Dock/Home Screen guidance.

The PWA bundle is built and served by the server. Service-worker activation is a separate mechanism from CLI, server or PLA updates.

## CLI launcher

The stable native `pop` launcher discovers the configured server, checks its published CLI manifest, validates immutable artifacts, installs the Node CLI in user scope and launches the active version. It remains able to diagnose missing dependencies or connectivity before the TypeScript CLI starts.

Do not replace this with global npm installation. Versioned private slots and atomic activation preserve rollback.

## Pop Local Access

Settings shows platform-specific PowerShell or shell commands. Public scripts and artifacts contain no account credential. Authentication happens interactively after installation. The installer validates size/hash and installs the minimal tray plus the launcher/PLA runtime in user scope.

The tray is not Pop Desktop. It presents connection state, opens the PWA, controls local access and supervises the PLA process.

## Distribution rules

- Versioned artifacts are immutable.
- Mutable aliases may point to current manifests/scripts but must not cache stale bytes.
- Download size and SHA-256 are verified before activation.
- Extraction rejects traversal and special entries.
- Installation is staged before activation.
- User data and credentials are not embedded in public installers.
- macOS and Windows native artifacts require their platform signing strategy for public distribution.

## Updates

PWA, CLI/launcher, server and PLA are independently understandable channels even when product versions are aligned. An update status event may invalidate UI state; it does not itself authorize or perform installation.

Never reuse a released version string for changed bytes.

## Failure behavior

An unreachable server prevents an online CLI session and should produce diagnosis rather than a broken TUI. A failed candidate does not replace the active CLI/runtime. A failed PWA activation keeps or restores a usable bundle. A local-access install failure must not affect the PWA or server.

## Change checklist

Test clean install, existing install, interruption, checksum mismatch, unsupported platform, no-admin scope, path quoting, server-origin handling, rollback, uninstall data preservation, immutable URLs and actual packaged artifacts on each target platform.
