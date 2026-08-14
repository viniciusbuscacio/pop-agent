# ADR 0003: Make management part of Pop Desktop

- Status: accepted for implementation
- Date: 2026-08-13

## Context

Pop Desktop and Pop Desktop Manager were delivered as separate macOS applications. The Manager owned the menu-bar item, configuration, diagnostics, update checks, and local runtime detection, while Pop Desktop owned the WKWebView window and the PWA-session-scoped PLA process.

This separation exposed implementation boundaries as product choices. Users had to understand which application to open, why two Pop applications were running, and which one controlled local access.

## Decision

Pop Desktop is the only installed client product. Its bundle contains the main `Pop Desktop` process and an internal helper named `Pop Desktop Tray`. Together they own:

- the WKWebView window;
- the menu-bar item;
- server configuration and secure credential storage;
- local Node and CLI detection;
- Pop CLI/PLA supervision;
- Start at Login, diagnostics, and update controls.

The two processes have a private pipe-based lifecycle. Closing Desktop terminates Tray; quitting Tray terminates Desktop. Starting Desktop always starts Tray, and the tray's Open action raises the existing Desktop window.

The former Manager Keychain services and single-instance lock remain migration inputs so existing sessions are preserved and old/new processes cannot run concurrently. `Pop Desktop Tray` is not a separate `.app`, installer, login item, or update target. It remains the technical helper/process name, but every normal user-facing label presents the single product name `Pop Desktop`; the technical helper name may appear only in diagnostics and process inspection.

## Consequences

- The build produces one `Pop Desktop.app` bundle.
- The window and status item use separate AppKit processes with coupled private lifecycle pipes.
- The former Manager is no longer built or installed as a separate product.
- Existing Manager operational code is reused rather than reimplemented.
- Release installation must remove the old login item and standalone bundle without deleting configuration or credentials.
- The historical ADRs and specifications remain useful records but require formal superseding amendments where they describe separate products.
