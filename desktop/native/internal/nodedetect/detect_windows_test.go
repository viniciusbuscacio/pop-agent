//go:build windows

package nodedetect

import (
	"path/filepath"
	"testing"
)

func TestWindowsCandidatesIncludePiNodeAndOfficialInstaller(t *testing.T) {
	home := t.TempDir()
	t.Setenv("LOCALAPPDATA", filepath.Join(home, "Local"))
	t.Setenv("ProgramFiles", filepath.Join(home, "Program Files"))
	t.Setenv("APPDATA", filepath.Join(home, "Roaming"))
	paths := candidatePaths(home)
	for _, want := range []string{
		filepath.Join(home, "Local", "pi-node", "current", "node.exe"),
		filepath.Join(home, "Program Files", "nodejs", "node.exe"),
	} {
		if !contains(paths, want) {
			t.Fatalf("candidate paths do not contain %q: %v", want, paths)
		}
	}
}
