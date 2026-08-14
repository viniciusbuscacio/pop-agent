# ADR 0001: Native AppKit tray spike

Status: superseded in part by ADR 0002

## Context

Wails v2.12 had no released system-tray API. Its open tray pull request was not a stable dependency. Libraries that own a separate Cocoa event loop could deadlock or freeze a Wails application.

## Spike decision

Use a small Darwin-only CGO adapter around `NSStatusItem` and `NSMenu`, scheduled on the AppKit main queue. The spike originally shared Wails' event loop and used Wails for window show/hide, single-instance handling, and Quit.

## Outcome

The native status item, template icon, menu updates, and explicit Quit path were validated. The product later became tray-only. ADR 0002 therefore preserves the native AppKit adapter but removes Wails, the window, and the frontend, and gives the native app its own single AppKit event loop.
