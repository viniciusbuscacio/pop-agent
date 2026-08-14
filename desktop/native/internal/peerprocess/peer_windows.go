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
