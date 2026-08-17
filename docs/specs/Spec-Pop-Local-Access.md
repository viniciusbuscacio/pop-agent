# Pop Agent — installed PWA and Pop Local Access

**Status:** normative
**Legacy coverage:** §17.1
**Primary implementation:** server/src/application/local-access, cli, local-access/tray
**Normative set:** all documents under `docs/specs/`, entered through `Spec-Pop-General.md`

> Section numbers are preserved from the former monolithic specification so
> existing code comments remain traceable. Cross-section references resolve
> through the legacy section map in `Spec-Pop-General.md`.
### 17.1 Installed PWA and optional local access

The desktop product is the existing PWA installed by the browser. Pop Agent
ships no WKWebView/WebView2 wrapper, tray helper, DMG, Setup app, Windows setup
executable, native Desktop download route or independently versioned Desktop
artifact. The browser owns the app window, operating-system registration,
permissions and removal; the server-owned PWA manifest names the installed app
**Pop Agent**.

Settings → Installation captures Chromium's `beforeinstallprompt` during boot
and exposes **Install Pop Agent** only while the browser says installation is
eligible. Safari, iOS and unsupported browsers receive their real Add to Dock or
Add to Home Screen instructions. PWA updates remain the normal service-worker
flow in §15 and do not depend on a native release.

Pop Local Access is optional and separate from PWA installation. Installing the
PWA grants no filesystem or command access. A local connection is outbound and
authenticated. Each stable computer identity has a persistent server-authoritative
**Allow access to local files** policy, disabled by default and synchronized
between every PWA, the tray and the CLI. The transport remains attached while
access is off so it can receive policy changes, but both server and PLA refuse
local calls. A disabled stale browser selection continues safely with server
tools; an unknown or unavailable enabled selection is still rejected.

Settings publishes same-origin PowerShell and bash commands. They install the
checksummed launcher and versioned tray per user, perform an interactive hidden
password login, protect the CLI profile and register the visible tray at login.
No password or token appears in argv, environment, URL, script or shell history.
The first tray release targets Windows and macOS; unsupported platforms are
refused honestly. The tray supervises `pop local-access --status-json`, shows
Access enabled/disabled, Connecting, Auth or update failures, and offers the
same **Allow access to local files** switch as the PWA, Open Pop Agent,
Reconnect, Start at Login, Diagnostics and Quit. Transport health is not called
Connected when file access is off.

`GET /v1/local-tools/connections` lists live transports for compatibility and
`GET /v1/local-tools/machines` lists deduplicated persistent computer identities,
permission and online state. That GET is the initial/reconnection snapshot;
attach, detach and permission changes emit `local-machines-changed` over the
same session-wide SSE channel as `chat-deleted`, so Settings never polls.
Settings stores only which allowed computer this
PWA should use when more than one is available; with exactly one allowed online
computer it selects that computer automatically. API sends
`x-pop-agent-local-connection` only after that choice. A stable machine id is
resolved to its current tray-preferred connection after reconnects.

## Related transport and synchronization

See [Spec-Pop-Events-Synchronization.md](Spec-Pop-Events-Synchronization.md).
