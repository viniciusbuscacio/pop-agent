package clidetect

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/winprocess"
)

const versionCommandIntroduced = "0.2.4"
const managedLocalAccessIntroduced = "0.2.6"

var semanticVersion = regexp.MustCompile(`^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$`)

type Result struct {
	CommandPath        string
	EntryPath          string
	PackagePath        string
	Version            string
	ManagedLocalAccess bool
	Err                error
}

type packageJSON struct {
	Name    string          `json:"name"`
	Version string          `json:"version"`
	Bin     json.RawMessage `json:"bin"`
}

// Detect locates a globally installed Pop CLI without relying on the minimal
// PATH inherited by Finder apps. Versions before 0.2.4 are inspected from
// package.json because they do not have a safe --version command.
func Detect(ctx context.Context, nodePath string) Result {
	home, err := os.UserHomeDir()
	if err != nil {
		return Result{Err: fmt.Errorf("find home directory: %w", err)}
	}
	var firstErr error
	seen := make(map[string]struct{})
	for _, candidate := range candidatePaths(home, nodePath) {
		if err := ctx.Err(); err != nil {
			return Result{Err: err}
		}
		entry, err := filepath.EvalSymlinks(candidate)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) && firstErr == nil {
				firstErr = err
			}
			continue
		}
		if _, ok := seen[entry]; ok {
			continue
		}
		seen[entry] = struct{}{}
		result, err := inspect(candidate, entry)
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("inspect %s: %w", candidate, err)
			}
			continue
		}
		if atLeast(result.Version, versionCommandIntroduced) && nodePath != "" {
			if err := verifyVersionCommand(ctx, nodePath, result.EntryPath, result.Version); err != nil {
				if firstErr == nil {
					firstErr = err
				}
				continue
			}
		}
		result.ManagedLocalAccess = atLeast(result.Version, managedLocalAccessIntroduced)
		return result
	}
	return Result{Err: firstErr}
}

func inspect(commandPath, entryPath string) (Result, error) {
	directory := filepath.Dir(entryPath)
	for range 5 {
		manifestPath := filepath.Join(directory, "package.json")
		if data, err := os.ReadFile(manifestPath); err == nil {
			if len(data) > 1<<20 {
				return Result{}, errors.New("package.json is too large")
			}
			var manifest packageJSON
			if err := json.Unmarshal(data, &manifest); err != nil {
				return Result{}, err
			}
			if manifest.Name == "pop-agent" && semanticVersion.MatchString(manifest.Version) && hasPopBin(manifest.Bin) {
				return Result{
					CommandPath: commandPath,
					EntryPath:   entryPath,
					PackagePath: directory,
					Version:     manifest.Version,
				}, nil
			}
		}
		parent := filepath.Dir(directory)
		if parent == directory {
			break
		}
		directory = parent
	}
	return Result{}, errors.New("Pop CLI package.json not found")
}

func hasPopBin(raw json.RawMessage) bool {
	var bins map[string]string
	if json.Unmarshal(raw, &bins) == nil {
		return bins["pop"] != ""
	}
	var single string
	return json.Unmarshal(raw, &single) == nil && single != ""
}

func verifyVersionCommand(ctx context.Context, nodePath, entryPath, want string) error {
	probeCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	output, err := winprocess.HideWindow(exec.CommandContext(probeCtx, nodePath, entryPath, "--version")).Output()
	if err != nil {
		return fmt.Errorf("run Pop CLI --version: %w", err)
	}
	if got := strings.TrimSpace(string(output)); got != want {
		return fmt.Errorf("Pop CLI version mismatch: package %s, command %s", want, got)
	}
	return nil
}

func candidatePaths(home, nodePath string) []string {
	paths := make([]string, 0, 32)
	if runtime.GOOS == "windows" {
		if nodePath != "" {
			directory := filepath.Dir(nodePath)
			paths = append(paths,
				filepath.Join(directory, "node_modules", "pop-agent", "dist", "main.js"),
				filepath.Join(directory, "pop.cmd"),
			)
		}
		if path, err := exec.LookPath("pop.cmd"); err == nil {
			paths = append(paths, path)
		}
		appData := os.Getenv("APPDATA")
		localAppData := os.Getenv("LOCALAPPDATA")
		paths = append(paths,
			filepath.Join(localAppData, "pi-node", "current", "node_modules", "pop-agent", "dist", "main.js"),
			filepath.Join(appData, "npm", "node_modules", "pop-agent", "dist", "main.js"),
			filepath.Join(home, ".volta", "tools", "image", "packages", "pop-agent", "lib", "node_modules", "pop-agent", "dist", "main.js"),
		)
		return paths
	}
	if nodePath != "" {
		paths = append(paths, filepath.Join(filepath.Dir(nodePath), "pop"))
	}
	if path, err := exec.LookPath("pop"); err == nil {
		paths = append(paths, path)
	}
	paths = append(paths,
		filepath.Join(home, ".local", "bin", "pop"),
		filepath.Join(home, ".hermes", "node", "bin", "pop"),
		filepath.Join(home, ".volta", "bin", "pop"),
	)
	paths = appendGlob(paths, filepath.Join(home, ".nvm", "versions", "node", "*", "bin", "pop"))
	paths = appendGlob(paths, filepath.Join(home, ".local", "share", "fnm", "node-versions", "*", "installation", "bin", "pop"))
	paths = appendGlob(paths, filepath.Join(home, ".local", "share", "mise", "installs", "node", "*", "bin", "pop"))
	paths = appendGlob(paths, filepath.Join(home, ".asdf", "installs", "nodejs", "*", "bin", "pop"))
	paths = append(paths, "/opt/homebrew/bin/pop", "/usr/local/bin/pop")
	return paths
}
func appendGlob(paths []string, pattern string) []string {
	matches, _ := filepath.Glob(pattern)
	sort.Sort(sort.Reverse(sort.StringSlice(matches)))
	return append(paths, matches...)
}

func atLeast(got, minimum string) bool {
	gotParts := strings.Split(strings.SplitN(got, "-", 2)[0], ".")
	minParts := strings.Split(minimum, ".")
	if len(gotParts) != 3 || len(minParts) != 3 {
		return false
	}
	for index := range 3 {
		if gotParts[index] != minParts[index] {
			return len(gotParts[index]) > len(minParts[index]) ||
				(len(gotParts[index]) == len(minParts[index]) && gotParts[index] > minParts[index])
		}
	}
	return true
}
