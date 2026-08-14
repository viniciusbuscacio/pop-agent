//go:build windows

package peerprocess

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

// EnsureSibling starts the named executable beside the caller when necessary,
// then invokes stopped after that exact peer process exits. The two Pop
// Desktop executables call this in opposite directions; their independent
// single-instance mutexes prevent a startup loop or duplicate UI/PLA process.
func EnsureSibling(name string, stopped func()) error {
	if filepath.Base(name) != name || filepath.Ext(name) != ".exe" {
		return errors.New("invalid peer executable name")
	}
	pid, found, err := findProcess(name)
	if err != nil {
		return err
	}
	if !found {
		executable, err := os.Executable()
		if err != nil {
			return fmt.Errorf("locate current executable: %w", err)
		}
		command := exec.Command(filepath.Join(filepath.Dir(executable), name))
		command.SysProcAttr = &syscall.SysProcAttr{
			CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP,
			HideWindow:    false,
		}
		if err := command.Start(); err != nil {
			return fmt.Errorf("start %s: %w", name, err)
		}
		pid = uint32(command.Process.Pid)
		if err := command.Process.Release(); err != nil {
			return fmt.Errorf("release %s: %w", name, err)
		}
	}

	handle, err := windows.OpenProcess(windows.SYNCHRONIZE, false, pid)
	if err != nil {
		return fmt.Errorf("observe %s: %w", name, err)
	}
	go func() {
		defer windows.CloseHandle(handle)
		_, _ = windows.WaitForSingleObject(handle, windows.INFINITE)
		if stopped != nil {
			stopped()
		}
	}()
	return nil
}

// WatchStop subscribes to the private graceful-stop signal for one component.
// Process-handle monitoring remains the crash/force-kill fallback.
func WatchStop(component string, stopped func()) (func(), error) {
	name, err := stopEventName(component)
	if err != nil {
		return nil, err
	}
	value, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return nil, err
	}
	event, err := windows.CreateEvent(nil, 0, 0, value)
	if err != nil {
		return nil, fmt.Errorf("create %s stop event: %w", component, err)
	}
	if err := windows.ResetEvent(event); err != nil {
		windows.CloseHandle(event)
		return nil, fmt.Errorf("reset %s stop event: %w", component, err)
	}
	go func() {
		result, waitErr := windows.WaitForSingleObject(event, windows.INFINITE)
		if waitErr == nil && result == windows.WAIT_OBJECT_0 && stopped != nil {
			stopped()
		}
	}()
	return func() { _ = windows.CloseHandle(event) }, nil
}

// SignalStop asks the named sibling to take its normal shutdown path. Missing
// listeners are expected during first-run configuration and process startup.
func SignalStop(component string) error {
	name, err := stopEventName(component)
	if err != nil {
		return err
	}
	value, err := windows.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	event, err := windows.OpenEvent(windows.EVENT_MODIFY_STATE, false, value)
	if errors.Is(err, windows.ERROR_FILE_NOT_FOUND) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("open %s stop event: %w", component, err)
	}
	defer windows.CloseHandle(event)
	if err := windows.SetEvent(event); err != nil {
		return fmt.Errorf("signal %s stop event: %w", component, err)
	}
	return nil
}

func stopEventName(component string) (string, error) {
	switch component {
	case "desktop", "tray":
		return `Local\com.popagent.` + component + `.stop`, nil
	default:
		return "", errors.New("invalid peer component")
	}
}

func findProcess(name string) (uint32, bool, error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0, false, fmt.Errorf("list Windows processes: %w", err)
	}
	defer windows.CloseHandle(snapshot)

	entry := windows.ProcessEntry32{Size: uint32(unsafe.Sizeof(windows.ProcessEntry32{}))}
	if err := windows.Process32First(snapshot, &entry); err != nil {
		return 0, false, fmt.Errorf("read Windows process list: %w", err)
	}
	for {
		if strings.EqualFold(windows.UTF16ToString(entry.ExeFile[:]), name) {
			return entry.ProcessID, true, nil
		}
		if err := windows.Process32Next(snapshot, &entry); err != nil {
			if errors.Is(err, windows.ERROR_NO_MORE_FILES) {
				return 0, false, nil
			}
			return 0, false, fmt.Errorf("read Windows process list: %w", err)
		}
	}
}
