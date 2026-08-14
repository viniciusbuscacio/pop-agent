//go:build windows

package peerprocess

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindProcessSeesCurrentWindowsTestProcess(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	pid, found, err := findProcess(filepath.Base(executable))
	if err != nil {
		t.Fatal(err)
	}
	if !found || pid == 0 {
		t.Fatalf("current process was not found: pid=%d found=%v", pid, found)
	}
}

func TestEnsureSiblingRejectsPaths(t *testing.T) {
	if err := EnsureSibling(`..\Pop Desktop.exe`, nil); err == nil {
		t.Fatal("peer path traversal was accepted")
	}
}
