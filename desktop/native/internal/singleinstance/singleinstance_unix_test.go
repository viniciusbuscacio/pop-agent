//go:build darwin || linux

package singleinstance

import (
	"path/filepath"
	"testing"
)

func TestAcquirePathPreventsSecondInstanceAndReleases(t *testing.T) {
	path := filepath.Join(t.TempDir(), "manager.lock")
	first, err := acquirePath(path)
	if err != nil {
		t.Fatal(err)
	}
	defer first.Release()

	if _, err := acquirePath(path); !IsAlreadyRunning(err) {
		t.Fatalf("second acquire error = %v", err)
	}
	if err := first.Release(); err != nil {
		t.Fatal(err)
	}

	third, err := acquirePath(path)
	if err != nil {
		t.Fatalf("acquire after release: %v", err)
	}
	if err := third.Release(); err != nil {
		t.Fatal(err)
	}
}
