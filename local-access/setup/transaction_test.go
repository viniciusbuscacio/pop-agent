package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFreshInstallAndUpgradeRollback(t *testing.T) {
	for _, upgrade := range []bool{false, true} {
		name := "fresh"
		if upgrade {
			name = "upgrade"
		}
		t.Run(name, func(t *testing.T) {
			for failAfter := 1; failAfter <= 3; failAfter++ {
				dir := t.TempDir()
				paths := []string{filepath.Join(dir, "tray.exe"), filepath.Join(dir, "launcher.exe"), filepath.Join(dir, "setup.exe")}
				if upgrade {
					for _, path := range paths {
						if err := os.WriteFile(path, []byte("MZ-original"), 0700); err != nil {
							t.Fatal(err)
						}
					}
				}
				before, err := snapshotFiles(paths)
				if err != nil {
					t.Fatal(err)
				}
				backup := filepath.Join(dir, "backup")
				if err = backupFiles(before, backup); err != nil {
					t.Fatal(err)
				}
				for i := 0; i < failAfter; i++ {
					if err = atomicFile(paths[i], []byte("MZ-new-version"), 0700); err != nil {
						t.Fatal(err)
					}
				}
				if err = restoreFiles(before); err != nil {
					t.Fatal(err)
				}
				for _, path := range paths {
					data, err := os.ReadFile(path)
					if upgrade {
						if err != nil || string(data) != "MZ-original" {
							t.Fatal("original bytes were not restored")
						}
					} else if !os.IsNotExist(err) {
						t.Fatal("partial fresh installation survived rollback")
					}
				}
			}
		})
	}
}

func TestRollbackReportsRecoveryFailure(t *testing.T) {
	path := filepath.Join(t.TempDir(), "tray.exe")
	if err := os.WriteFile(path, []byte("MZ-original"), 0700); err != nil {
		t.Fatal(err)
	}
	before, err := snapshotFiles([]string{path})
	if err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err = os.Mkdir(path, 0700); err != nil {
		t.Fatal(err)
	}
	if err = restoreFiles(before); err == nil {
		t.Fatal("failed recovery was reported as success")
	}
}
