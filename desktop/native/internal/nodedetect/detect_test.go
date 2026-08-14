package nodedetect

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestCompatibleMinimumAndNewerVersions(t *testing.T) {
	tests := []struct {
		version string
		want    bool
	}{
		{"v22.18.9", false},
		{"v22.19.0", true},
		{"v22.22.3", true},
		{"v23.10.0", true},
		{"v21.99.99", false},
		{"not-node", false},
	}
	for _, test := range tests {
		if got := compatible(test.version); got != test.want {
			t.Errorf("compatible(%q) = %t, want %t", test.version, got, test.want)
		}
	}
}

func TestDetectCandidatesPrefersFirstCompatibleInstallation(t *testing.T) {
	versions := map[string]string{
		"/old/node":    "v20.19.0",
		"/hermes/node": "v22.22.3",
		"/brew/node":   "v23.10.0",
	}
	result := detectCandidates(context.Background(), []string{"/old/node", "/hermes/node", "/brew/node"}, func(_ context.Context, path string) (string, error) {
		version, ok := versions[path]
		if !ok {
			return "", os.ErrNotExist
		}
		return version, nil
	})
	if result.Path != "/hermes/node" || result.Version != "v22.22.3" || !result.Compatible || result.Err != nil {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestDetectCandidatesReturnsIncompatibleInstallationWhenNoCompatibleOneExists(t *testing.T) {
	result := detectCandidates(context.Background(), []string{"/old/node"}, func(context.Context, string) (string, error) {
		return "v20.11.1", nil
	})
	if result.Path != "/old/node" || result.Version != "v20.11.1" || result.Compatible {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestDetectCandidatesDistinguishesMissingFromProbeFailure(t *testing.T) {
	missing := detectCandidates(context.Background(), []string{"/missing/node"}, func(context.Context, string) (string, error) {
		return "", os.ErrNotExist
	})
	if missing.Path != "" || missing.Err != nil {
		t.Fatalf("missing result: %+v", missing)
	}

	failure := detectCandidates(context.Background(), []string{"/broken/node"}, func(context.Context, string) (string, error) {
		return "", errors.New("cannot execute")
	})
	if failure.Err == nil {
		t.Fatalf("expected probe failure, got %+v", failure)
	}
}

func TestCandidatePathsIncludeVersionManagersAndPackageManagers(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("Windows candidates have a dedicated test")
	}
	home := t.TempDir()
	nvmNode := filepath.Join(home, ".nvm", "versions", "node", "v22.19.0", "bin", "node")
	if err := os.MkdirAll(filepath.Dir(nvmNode), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(nvmNode, []byte("node"), 0o755); err != nil {
		t.Fatal(err)
	}
	paths := candidatePaths(home)
	hermesNode := filepath.Join(home, ".hermes", "node", "bin", "node")
	for _, want := range []string{
		hermesNode,
		nvmNode,
		"/opt/homebrew/bin/node",
		"/usr/local/bin/node",
	} {
		if !contains(paths, want) {
			t.Errorf("candidate paths do not contain %q: %v", want, paths)
		}
	}
	if indexOf(paths, hermesNode) != 0 {
		t.Fatalf("Hermes must be the first deterministic candidate: %v", paths)
	}
}

func indexOf(values []string, want string) int {
	for index, value := range values {
		if value == want {
			return index
		}
	}
	return len(values)
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
