//go:build windows

package main

import _ "embed"

//go:embed tray_windows.ico
var trayIcon []byte
