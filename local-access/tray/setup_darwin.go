//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
int popSetupDialog(const char*, const char*, const char*, int);
*/
import "C"
import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"unsafe"
)

func setupDialog(title, message, button string, cancel bool) bool {
	t, m, b := C.CString(title), C.CString(message), C.CString(button)
	defer C.free(unsafe.Pointer(t))
	defer C.free(unsafe.Pointer(m))
	defer C.free(unsafe.Pointer(b))
	flag := C.int(0)
	if cancel {
		flag = 1
	}
	return C.popSetupDialog(t, m, b, flag) != 0
}
func setupTarget() (string, error) {
	home, err := os.UserHomeDir()
	return filepath.Join(home, "Applications", "Pop Local Access.app", "Contents", "MacOS", "Pop Local Access"), err
}
func stopForSetup(string) error { return nil } // Atomic rename is supported while the old Mach-O is running.
func restartAfterSetup(target string) error {
	label := fmt.Sprintf("gui/%d/com.popagent.local-access", os.Getuid())
	if exec.Command("launchctl", "print", label).Run() == nil {
		return exec.Command("launchctl", "kickstart", "-k", label).Run()
	}
	// Start-at-login may be disabled: restart only this application without creating a LaunchAgent.
	_ = exec.Command("pkill", "-TERM", "-f", "^"+regexp.QuoteMeta(target)+"$").Run()
	return exec.Command("open", "-n", filepath.Dir(filepath.Dir(filepath.Dir(target)))).Run()
}

func setupPayload(executable string) (string, error) {
	path := filepath.Join(filepath.Dir(filepath.Dir(executable)), "Resources", "Pop Local Access")
	return path, exec.Command("codesign", "--verify", "--strict", path).Run()
}
