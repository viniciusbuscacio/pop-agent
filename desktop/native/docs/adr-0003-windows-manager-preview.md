# ADR 0003: Native Windows tray manager preview

Status: accepted for preview

## Context

The manager began as a macOS-only AppKit utility. The owner now needs the same tray-only operational companion on Windows 11 x64. The React interface remains the server-owned PWA, and the Windows manager must not introduce a dashboard, Chromium, a second agent, or provider credentials.

## Decision

Keep the existing pure-Go manager core and add thin Windows adapters:

- a native Win32 notification-area menu through a pinned `getlantern/systray` adapter;
- a small local patch that preserves alpha in colored status menu icons;
- Windows Credential Manager for the server session;
- the current-user `Run` registry key for optional Start at Login;
- a named Win32 mutex for single-instance enforcement;
- a purpose-built native server URL/password dialog and MessageBox for short prompts;
- direct Node/CLI discovery across the installed Pi runtime, official Node, PATH, npm and common version-manager locations;
- process-tree termination through `taskkill.exe`, invoked directly without a command shell.

The preview manages server authentication, Node, and Pop CLI. Pop Desktop for Windows is deliberately disabled until its separate WebView2 host and immutable server release package exist. The macOS `.app` endpoint is never installed on Windows.

## Security

- The password exists only for the login request and is never persisted by the dialog.
- Session tokens live in Windows Credential Manager, never `config.json`, argv, environment, URLs, or logs.
- All child programs are invoked directly without `cmd.exe` or PowerShell command interpolation.
- The manager runs per-user and requests no elevation.

## Build and acceptance

`gate-windows.ps1` runs `go vet`, all Go tests, and a GUI-subsystem build. The preview is accepted when the native menu opens from the tray, a second instance exits, Node and CLI are detected, server login survives restart, Start at Login toggles, Diagnostics opens, and Quit leaves no manager process.

A signed per-user installer and the WebView2 Pop Desktop host are separate follow-up milestones.
