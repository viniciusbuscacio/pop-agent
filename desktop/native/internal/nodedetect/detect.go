package nodedetect

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// MinimumVersion mirrors the Node engine required by Pop Agent 0.2.3.
const MinimumVersion = "22.19.0"

var versionPattern = regexp.MustCompile(`^v?(\d+)\.(\d+)\.(\d+)`)

type Result struct {
	Path       string
	Version    string
	Compatible bool
	Err        error
}

type probe func(context.Context, string) (string, error)

// Detect searches common macOS Node installations without running a login
// shell. Finder-launched applications receive a minimal PATH, so LookPath
// alone cannot discover version-manager and Homebrew installations.
func Detect(ctx context.Context) Result {
	home, err := os.UserHomeDir()
	if err != nil {
		return Result{Err: fmt.Errorf("find home directory: %w", err)}
	}
	return detectCandidates(ctx, candidatePaths(home), probeVersion)
}

func detectCandidates(ctx context.Context, candidates []string, run probe) Result {
	var incompatible *Result
	var firstErr error
	seen := make(map[string]struct{})
	for _, candidate := range candidates {
		if err := ctx.Err(); err != nil {
			return Result{Err: err}
		}
		canonical := candidate
		if resolved, err := filepath.EvalSymlinks(candidate); err == nil {
			canonical = resolved
		}
		if _, ok := seen[canonical]; ok {
			continue
		}
		seen[canonical] = struct{}{}

		version, err := run(ctx, candidate)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) && firstErr == nil {
				firstErr = fmt.Errorf("probe %s: %w", candidate, err)
			}
			continue
		}
		result := Result{Path: candidate, Version: version, Compatible: compatible(version)}
		if result.Compatible {
			return result
		}
		if incompatible == nil {
			copy := result
			incompatible = &copy
		}
	}
	if incompatible != nil {
		return *incompatible
	}
	return Result{Err: firstErr}
}

func candidatePaths(home string) []string {
	paths := make([]string, 0, 24)
	// Hermes is the deterministic first choice when compatible; the remaining
	// managers and package installations are searched without invoking a shell.
	paths = append(paths, filepath.Join(home, ".hermes", "node", "bin", "node"))
	paths = appendGlob(paths, filepath.Join(home, ".local", "share", "fnm", "node-versions", "*", "installation", "bin", "node"))
	paths = append(paths, filepath.Join(home, ".volta", "bin", "node"))
	paths = appendGlob(paths, filepath.Join(home, ".nvm", "versions", "node", "*", "bin", "node"))
	paths = appendGlob(paths, filepath.Join(home, ".local", "share", "mise", "installs", "node", "*", "bin", "node"))
	paths = appendGlob(paths, filepath.Join(home, ".asdf", "installs", "nodejs", "*", "bin", "node"))
	paths = append(paths, filepath.Join(home, ".local", "bin", "node"))
	paths = append(paths, "/opt/homebrew/bin/node", "/usr/local/bin/node")
	if path, err := exec.LookPath("node"); err == nil {
		paths = append(paths, path)
	}
	return paths
}

func appendGlob(paths []string, pattern string) []string {
	matches, _ := filepath.Glob(pattern)
	sort.Sort(sort.Reverse(sort.StringSlice(matches)))
	return append(paths, matches...)
}

func probeVersion(ctx context.Context, path string) (string, error) {
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	output, err := exec.CommandContext(probeCtx, path, "--version").Output()
	if err != nil {
		return "", err
	}
	version := strings.TrimSpace(string(output))
	if _, ok := parseVersion(version); !ok {
		return "", fmt.Errorf("unexpected version %q", version)
	}
	if !strings.HasPrefix(version, "v") {
		version = "v" + version
	}
	return version, nil
}

func compatible(version string) bool {
	got, ok := parseVersion(version)
	if !ok {
		return false
	}
	minimum, _ := parseVersion(MinimumVersion)
	for i := range got {
		if got[i] != minimum[i] {
			return got[i] > minimum[i]
		}
	}
	return true
}

func parseVersion(value string) ([3]int, bool) {
	match := versionPattern.FindStringSubmatch(strings.TrimSpace(value))
	if match == nil {
		return [3]int{}, false
	}
	var version [3]int
	for index := range version {
		part, err := strconv.Atoi(match[index+1])
		if err != nil {
			return [3]int{}, false
		}
		version[index] = part
	}
	return version, true
}
