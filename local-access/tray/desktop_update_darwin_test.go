//go:build darwin

package main

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestDesktopSwapAndRollback(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(map[bool]string{false: "success", true: "startup failure"}[fail], func(t *testing.T) {
			root := t.TempDir()
			target := filepath.Join(root, "installed.app")
			candidate := filepath.Join(root, "candidate.app")
			backup := filepath.Join(root, "previous.app")
			for path, version := range map[string]string{target: "old", candidate: "new"} {
				_ = os.Mkdir(path, 0700)
				_ = os.WriteFile(filepath.Join(path, "program"), []byte(version), 0700)
			}
			profile := filepath.Join(root, "profile")
			_ = os.WriteFile(profile, []byte("preserved"), 0600)
			err := swapDesktopBundle(target, candidate, backup, func() error {
				data, _ := os.ReadFile(filepath.Join(target, "program"))
				if string(data) != "new" {
					t.Fatal("candidate not activated")
				}
				if fail {
					return errors.New("cannot start")
				}
				return nil
			})
			if (err != nil) != fail {
				t.Fatalf("unexpected error %v", err)
			}
			want := "new"
			if fail {
				want = "old"
			}
			data, _ := os.ReadFile(filepath.Join(target, "program"))
			if string(data) != want {
				t.Fatalf("got %s", data)
			}
			data, _ = os.ReadFile(profile)
			if string(data) != "preserved" {
				t.Fatal("profile changed")
			}
		})
	}
}
func TestDesktopMissingCandidateRestoresOriginal(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "installed.app")
	_ = os.Mkdir(target, 0700)
	if swapDesktopBundle(target, filepath.Join(root, "missing"), filepath.Join(root, "backup"), func() error { t.Fatal("must not start"); return nil }) == nil {
		t.Fatal("expected error")
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatal("original was not restored")
	}
}
