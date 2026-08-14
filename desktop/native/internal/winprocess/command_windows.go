//go:build windows

package winprocess

import (
	"os/exec"
	"syscall"

	"golang.org/x/sys/windows"
)

// HideWindow prevents console applications such as node.exe from flashing a
// terminal when launched by the GUI manager.
func HideWindow(command *exec.Cmd) *exec.Cmd {
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: windows.CREATE_NO_WINDOW,
		HideWindow:    true,
	}
	return command
}
