# Marco 0 revised manual test

Fully quit any older Pop Desktop Manager instance before opening the rebuilt application at `build/bin/Pop Desktop Manager.app`.

1. Launch the application. One monochrome Pop balloon appears in the macOS menu bar, adapts in light/dark mode, and no manager icon remains in the Dock.
2. The app opens no main window. The first menu row, **Pop Desktop Manager**, is bold and uses the adaptive primary label colour rather than the dimmed disabled style. The menu shows legible Server, Desktop, CLI, and Node states with native status dots: green for healthy/connected, yellow for transitional or attention-required, red for failure/offline, and neutral grey for inactive/not configured.
3. Every component row has a native submenu arrow. Opening Server shows its coloured status, configured URL, **Check Connection**, and **Configure Server…**. The top-level Server row remains `Connected`; only its submenu displays `Connected · DD/MM/YYYY HH:mm:ss` using the Mac's local time. Pop Desktop exposes installation details and open/update actions. Node detects installations outside the Finder PATH, prefers compatible Hermes, shows its version in green, and exposes status, version, absolute path, and **Check Again** in its submenu. Pop CLI is detected beside that Node and in the same common installation families; its submenu shows status, package version, command path, selected Node runtime, **Check Again**, and **Update CLI…**. Unavailable actions remain disabled.
4. **Configure Server…** opens one native dialog with URL and secure password fields. Typing and Command-X/C/V/A work in both fields; in particular, paste a URL with Command-V. Cancel and closing the dialog leave the tray responsive.
5. **Diagnostics…** opens a short native report. Closing it leaves the tray responsive.
6. **Start at Login** registers and unregisters the application in System Settings → General → Login Items and reflects its checked state.
7. Launching the `.app` again does not create a second tray item or process.
8. With VoiceOver, the tray menu and native dialogs have understandable labels and keyboard navigation.
9. **Quit Pop Desktop Manager** removes the tray and exits the Manager completely without terminating an independently open Pop Desktop.
10. Open Pop Desktop while the Manager is closed; after web login, exactly one `--managed-local-access` child belongs to Pop Desktop. Closing Pop Desktop terminates that child completely.
11. Reopen the Manager `.app` after Quit and confirm one functional tray instance appears.

Activity Monitor or `pgrep -fl 'Pop Desktop Manager'` must show no surviving Manager process after Quit. With Pop Desktop closed, no Desktop-owned `--managed-local-access` process may survive.
