package applifecycle

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDesktopAndTrayLifecycleAreCoupled(t *testing.T) {
	helper := filepath.Join(t.TempDir(), "Pop Desktop Tray")
	if err := os.WriteFile(helper, []byte("#!/bin/sh\nprintf s >&4\ncat <&3 >/dev/null\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	link, err := StartTray(helper)
	if err != nil {
		t.Fatal(err)
	}
	shown := make(chan struct{}, 1)
	stopped := make(chan struct{}, 1)
	link.Watch(func() { shown <- struct{}{} }, func() { stopped <- struct{}{} })
	select {
	case <-shown:
	case <-time.After(2 * time.Second):
		t.Fatal("tray did not request the Desktop window")
	}
	link.Close()
	select {
	case <-stopped:
	case <-time.After(2 * time.Second):
		t.Fatal("Desktop did not observe tray shutdown")
	}
}

func TestStartTrayRejectsUnexpectedExecutableName(t *testing.T) {
	if _, err := StartTray(filepath.Join(t.TempDir(), "other")); err == nil {
		t.Fatal("expected helper name validation error")
	}
}
