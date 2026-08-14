//go:build windows

package localaccess

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"

	"golang.org/x/sys/windows"
)

func processGroupAttributes() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NO_WINDOW, HideWindow: true}
}

func attachProcessGroup(*exec.Cmd) error { return nil }

func terminateProcessGroup(cmd *exec.Cmd) { taskkill(cmd, false) }
func killProcessGroup(cmd *exec.Cmd)      { taskkill(cmd, true) }

func taskkill(cmd *exec.Cmd, force bool) {
	if cmd.Process == nil {
		return
	}
	args := []string{"/PID", strconv.Itoa(cmd.Process.Pid), "/T"}
	if force {
		args = append(args, "/F")
	}
	executable := filepath.Join(os.Getenv("SystemRoot"), "System32", "taskkill.exe")
	if os.Getenv("SystemRoot") == "" {
		executable = "taskkill.exe"
	}
	command := exec.Command(executable, args...)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = command.Run()
}
