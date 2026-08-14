# Pop Desktop agent guide

Read `../go-apps/go-apps.spec` before changing this repository when it is available. It is normative for structural and release conventions that still apply. The Pop Agent repository's `pop-agent.spec` remains the technical source of truth; architecture drafts in the user's vault do not override it until approved and incorporated.

## Scope

This repository contains the native Pop Desktop hosts. Pop Desktop is one installed product containing the WebView process and an internal `Pop Desktop Tray` helper for menu-bar controls, server configuration, diagnostics, updates, and operational supervision. The helper is not a separate app, installer, login item, or update target.

The Pop Desktop interface/PWA and the Pop Agent server remain in the Pop Agent monorepo. Keep operational rules in pure Go under `internal/`; AppKit/WebKit and Win32/WebView2 code remains thin platform adapters. The session bridge is allowed only for the configured main-frame origin and must expose no filesystem, shell, or other privileged native capability.

## Branding

Use the official Pop Agent balloon for the application icon and a native monochrome adaptation for tray/menu-bar use. Do not copy fonts, colours, icons, or visual styling from examples or sibling applications.

## Language and workflow

- Everything committed here is English.
- Use focused conventional commits and worktrees for parallel or risky work.
- Before every commit run the repository gate.
- Review the diff and verify a clean worktree after the commit.

## Lifecycle boundaries

- Cocoa and Win32 event loops remain on the platform's required main thread.
- Closing the Pop Desktop window terminates Desktop and its internal Tray helper.
- Quitting Pop Desktop Tray terminates Desktop and all managed children.
- The Tray's Open action raises the existing window; it does not create another application instance.
- Never let a generic close callback block explicit Quit.
- Pop Desktop opens no local network listener.
