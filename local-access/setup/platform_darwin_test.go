//go:build darwin

package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestShellPathPreservesExistingConfiguration(t *testing.T) {
	original := "# user settings\nexport EDITOR=vim\n"
	bin := "/Users/test/Library/Application Support/Pop Agent/cli"
	one, e := shellPathBlock(original, bin, true)
	if e != nil {
		t.Fatal(e)
	}
	two, e := shellPathBlock(one, bin, true)
	if e != nil || one != two {
		t.Fatal("PATH registration was not idempotent")
	}
	removed, e := shellPathBlock(two, bin, false)
	if e != nil || removed != original {
		t.Fatal("user shell configuration changed")
	}
	if strings.Count(two, pathStart) != 1 {
		t.Fatal(two)
	}
	if _, e = shellPathBlock(pathStart, "", true); e == nil {
		t.Fatal("accepted incomplete block")
	}
}
func TestFileRollbackPreservesPermissions(t *testing.T) {
	p := filepath.Join(t.TempDir(), "profile")
	if e := os.WriteFile(p, []byte("before"), 0600); e != nil {
		t.Fatal(e)
	}
	saved, e := snapshotFiles([]string{p})
	if e != nil {
		t.Fatal(e)
	}
	if e = atomicFile(p, []byte("after"), 0700); e != nil {
		t.Fatal(e)
	}
	if e = restoreFiles(saved); e != nil {
		t.Fatal(e)
	}
	b, _ := os.ReadFile(p)
	i, _ := os.Stat(p)
	if string(b) != "before" || i.Mode().Perm() != 0600 {
		t.Fatal("rollback did not preserve bytes/mode")
	}
}
func TestDesktopPlistEscapesVersion(t *testing.T) {
	s := string(desktopPlist("a&b"))
	if !strings.Contains(s, "a&amp;b") || !strings.Contains(s, "com.popagent.desktop") {
		t.Fatal(s)
	}
}
