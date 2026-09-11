//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#include <stdlib.h>
void popDesktopRun(const char*, const char*);
*/
import "C"
import (
	_ "embed"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"unsafe"
)

//go:embed desktop_theme.js
var desktopThemeScript string

func desktopBundle() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Applications", "Pop Agent Desktop.app")
}
func openDesktop(server string) error {
	if _, err := os.Stat(desktopBundle()); err != nil {
		return openExternal(server)
	}
	return exec.Command("open", desktopBundle()).Run()
}
func closeDesktopWindow() {
	target := filepath.Join(desktopBundle(), "Contents", "MacOS", "Pop Agent Desktop")
	// Ask only our own process to quit; the browser PWA is unrelated.
	for _, running := range desktopPIDs(target) {
		_ = running.Signal(os.Interrupt)
	}
}
func desktopPIDs(target string) []*os.Process {
	out, _ := exec.Command("pgrep", "-f", "^"+regexp.QuoteMeta(target)+"$").Output()
	var processes []*os.Process
	for _, id := range strings.Fields(string(out)) {
		var pid int
		if _, err := fmt.Sscan(id, &pid); err == nil {
			if p, e := os.FindProcess(pid); e == nil {
				processes = append(processes, p)
			}
		}
	}
	return processes
}
func runDesktopIfRequested() bool {
	self, err := os.Executable()
	if err != nil || filepath.Base(self) != "Pop Agent Desktop" {
		return false
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	profileFile, err := profilePath()
	if err != nil {
		return true
	}
	_, profile, err := readProfiles(profileFile)
	if err != nil {
		setupDialog("Pop Agent Desktop", "Run Pop Agent Setup to connect to your server.", "OK", false)
		return true
	}
	tray := exec.Command(filepath.Join(filepath.Dir(filepath.Dir(self)), "Helpers", "Pop Local Access.app", "Contents", "MacOS", "Pop Local Access"))
	if err := tray.Start(); err == nil {
		_ = tray.Process.Release()
	}
	origin := C.CString(safeOrigin(profile.URL))
	defer C.free(unsafe.Pointer(origin))
	script := C.CString(desktopThemeScript)
	defer C.free(unsafe.Pointer(script))
	C.popDesktopRun(origin, script)
	return true
}
