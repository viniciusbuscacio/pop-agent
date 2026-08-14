//go:build windows

package singleinstance

import (
	"fmt"
	"os"
	"testing"
)

func TestWindowsMutexRejectsSecondInstance(t *testing.T) {
	name := fmt.Sprintf(`Local\com.popagent.desktop-manager.test.%d`, os.Getpid())
	first, err := acquireNamed(name)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	second, err := acquireNamed(name)
	if second != nil {
		second.Release()
	}
	if !IsAlreadyRunning(err) {
		t.Fatalf("second acquire error = %v", err)
	}
}

func TestWindowsDesktopUsesSeparateMutex(t *testing.T) {
	if desktopMutexName == mutexName {
		t.Fatal("Desktop and Manager must not share a mutex")
	}
	name := fmt.Sprintf(`Local\com.popagent.desktop.test.%d`, os.Getpid())
	first, err := acquireNamed(name)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()
	if second, err := acquireNamed(name); second != nil || !IsAlreadyRunning(err) {
		if second != nil {
			second.Release()
		}
		t.Fatalf("second Desktop lock = %v, %v", second, err)
	}
}
