//go:build windows

package singleinstance

import (
	"errors"
	"fmt"

	"golang.org/x/sys/windows"
)

const (
	mutexName        = `Local\com.popagent.desktop-manager`
	desktopMutexName = `Local\com.popagent.desktop`
)

func acquire() (*Lock, error) { return acquireNamed(mutexName) }

func AcquireDesktop() (*Lock, error) { return acquireNamed(desktopMutexName) }

func acquireNamed(value string) (*Lock, error) {
	name, err := windows.UTF16PtrFromString(value)
	if err != nil {
		return nil, err
	}
	handle, err := windows.CreateMutex(nil, false, name)
	if errors.Is(err, windows.ERROR_ALREADY_EXISTS) {
		windows.CloseHandle(handle)
		return nil, ErrAlreadyRunning
	}
	if err != nil {
		return nil, fmt.Errorf("create manager mutex: %w", err)
	}
	if errors.Is(windows.GetLastError(), windows.ERROR_ALREADY_EXISTS) {
		windows.CloseHandle(handle)
		return nil, ErrAlreadyRunning
	}
	return &Lock{release: func() error { return windows.CloseHandle(handle) }}, nil
}
