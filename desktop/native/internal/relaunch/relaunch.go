//go:build !windows

package relaunch

import (
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"
	"time"
)

const helperFlag = "--finish-desktop-update"
const maximumWait = 30 * time.Second

// Start launches the newly installed executable as an update finisher. It does
// not open the app until both old processes have exited and released their
// lifecycle pipes and single-instance lock.
func Start(bundle string, desktopPID, trayPID int) error {
	if filepath.Base(bundle) != "Pop Desktop.app" || desktopPID <= 0 || trayPID <= 0 {
		return errors.New("invalid Pop Desktop relaunch request")
	}
	executable := filepath.Join(bundle, "Contents", "MacOS", "Pop Desktop")
	command := exec.Command(executable, helperFlag, bundle, strconv.Itoa(desktopPID), strconv.Itoa(trayPID))
	command.Stdin = nil
	command.Stdout = nil
	command.Stderr = nil
	command.SysProcAttr = detachedProcessAttributes()
	if err := command.Start(); err != nil {
		return fmt.Errorf("start Pop Desktop update finisher: %w", err)
	}
	return command.Process.Release()
}

// RunIfRequested handles the private mode before Cocoa, the Tray helper and the
// single-instance lock are initialized. The boolean says whether normal app
// startup must stop.
func RunIfRequested(args []string) (bool, int) {
	if len(args) == 0 || args[0] != helperFlag {
		return false, 0
	}
	if len(args) != 4 || filepath.Base(args[1]) != "Pop Desktop.app" {
		return true, 2
	}
	desktopPID, firstErr := strconv.Atoi(args[2])
	trayPID, secondErr := strconv.Atoi(args[3])
	if firstErr != nil || secondErr != nil || desktopPID <= 0 || trayPID <= 0 {
		return true, 2
	}
	deadline := time.Now().Add(maximumWait)
	for processAlive(desktopPID) || processAlive(trayPID) {
		if time.Now().After(deadline) {
			return true, 1
		}
		time.Sleep(100 * time.Millisecond)
	}
	command := exec.Command("/usr/bin/open", args[1])
	command.Stdin = nil
	command.Stdout = nil
	command.Stderr = nil
	if err := command.Start(); err != nil {
		return true, 1
	}
	if err := command.Process.Release(); err != nil {
		return true, 1
	}
	return true, 0
}

func processAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}
