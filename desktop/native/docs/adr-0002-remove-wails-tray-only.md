# ADR 0002: Remove Wails for the tray-only manager

Status: accepted

## Context

The original spike used Wails v2 to host a Vue dashboard while a native AppKit adapter supplied the status item. Product scope was subsequently narrowed: Pop Desktop Manager is a menu-bar utility with no main window, dashboard, frontend, or webview. The Pop Desktop PWA remains the full interface.

With the window removed, Wails only retained the webview build, embedded frontend, window lifecycle, and single-instance helper. None justified the runtime and packaging cost.

## Decision

Run a Go binary directly on the original main thread and use one AppKit event loop. Keep the existing `NSStatusItem` adapter, add native dialogs for short interactions, and replace Wails' single-instance helper with an advisory file lock under Application Support.

Use `LSUIElement=true`, the bundle identifier `com.popagent.desktop-manager`, the official Pop Agent balloon application icon, and its monochrome template adaptation in the menu bar.

## Consequences

- Wails, Vue, npm, the webview, and the embedded frontend are removed.
- The app is built by `build-darwin.sh` into a standard `.app` bundle.
- Rich or persistent interaction must open the Pop Desktop PWA or a system surface.
- Native menu, dialogs, Start at Login, VoiceOver, and Quit require manual macOS validation.
- ADR 0001 remains the historical tray spike; this ADR supersedes its Wails window and lifecycle decisions.
