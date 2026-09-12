//go:build darwin

package main

import _ "embed"

//go:embed trayTemplate.png
var trayIcon []byte
