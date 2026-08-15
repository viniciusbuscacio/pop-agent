//go:build windows

package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"syscall"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

var errAlreadyRunning = errors.New("Pop Local Access is already running")
var mutexHandle windows.Handle

const runKeyPath = `Software\Microsoft\Windows\CurrentVersion\Run`
const runValue = "Pop Local Access"

func childProcessAttributes() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP | windows.CREATE_NO_WINDOW, HideWindow: true}
}

func terminateChild(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	taskkill := filepath.Join(os.Getenv("SystemRoot"), "System32", "taskkill.exe")
	command := exec.Command(taskkill, "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F")
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = command.Run()
}

func openExternal(target string) error {
	return exec.Command(filepath.Join(os.Getenv("SystemRoot"), "explorer.exe"), target).Start()
}

func singleInstance() error {
	name, err := windows.UTF16PtrFromString(`Local\PopAgentLocalAccess`)
	if err != nil {
		return err
	}
	handle, err := windows.CreateMutex(nil, false, name)
	if err != nil {
		return err
	}
	if windows.GetLastError() == windows.ERROR_ALREADY_EXISTS {
		windows.CloseHandle(handle)
		return errAlreadyRunning
	}
	mutexHandle = handle
	return nil
}

func startAtLoginEnabled() (bool, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.QUERY_VALUE)
	if err == registry.ErrNotExist {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	defer key.Close()
	value, _, err := key.GetStringValue(runValue)
	if err == registry.ErrNotExist {
		return false, nil
	}
	return value != "", err
}

func setStartAtLogin(enabled bool) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer key.Close()
	if !enabled {
		if err := key.DeleteValue(runValue); err != nil && err != registry.ErrNotExist {
			return err
		}
		return nil
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	if err := key.SetStringValue(runValue, `"`+executable+`"`); err != nil {
		return fmt.Errorf("write startup entry: %w", err)
	}
	return nil
}
