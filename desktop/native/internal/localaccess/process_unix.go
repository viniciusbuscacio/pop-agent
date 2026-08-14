//go:build !windows

package localaccess

import (
	"os/exec"
	"syscall"
)

func processGroupAttributes() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setpgid: true} }
func attachProcessGroup(*exec.Cmd) error           { return nil }
func terminateProcessGroup(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	}
}
func killProcessGroup(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
