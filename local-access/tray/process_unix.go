//go:build !windows

package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"

	"golang.org/x/sys/unix"
)

var errAlreadyRunning = errors.New("Pop Local Access is already running")
var lockFile *os.File

func childProcessAttributes() *syscall.SysProcAttr { return &syscall.SysProcAttr{Setpgid: true} }

func terminateChild(cmd *exec.Cmd) {
	if cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGTERM)
	}
}

func openExternal(target string) error { return exec.Command("open", target).Start() }

func singleInstance() error {
	home, err := os.UserHomeDir()
	if err != nil {
		return err
	}
	dir := filepath.Join(home, ".local", "state", "pop-agent")
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(dir, "local-access.lock"), os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return err
	}
	if err := unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		file.Close()
		if errors.Is(err, unix.EWOULDBLOCK) {
			return errAlreadyRunning
		}
		return err
	}
	lockFile = file
	return nil
}
