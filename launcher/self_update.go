package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

type launcherArtifact struct {
	File   string `json:"file"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type launcherManifest struct {
	Version   string                      `json:"version"`
	Artifacts map[string]launcherArtifact `json:"artifacts"`
}

// Checks the same-origin native release before CLI minimum-version checks.
func (l *launcher) updateLauncher(serverURL string) (string, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serverURL+"/cli/launcher/manifest.json", nil)
	if err != nil {
		return "", false, err
	}
	response, err := l.http.Do(req)
	if err != nil {
		return "", false, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", false, fmt.Errorf("launcher manifest returned HTTP %d", response.StatusCode)
	}
	if response.Request.URL.Scheme != req.URL.Scheme || response.Request.URL.Host != req.URL.Host {
		return "", false, fmt.Errorf("launcher manifest redirected outside its trusted source")
	}
	var release launcherManifest
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&release); err != nil {
		return "", false, err
	}
	if !validVersion(release.Version) {
		return "", false, fmt.Errorf("invalid launcher version")
	}
	if compareVersions(release.Version, launcherVersion) <= 0 {
		return "", false, nil
	}
	target := runtime.GOOS + "-" + runtime.GOARCH
	artifact, ok := release.Artifacts[target]
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	expected := "pop-launcher-" + release.Version + "-" + target + suffix
	if !ok || artifact.File != expected || artifact.Size <= 0 || len(artifact.SHA256) != 64 {
		return "", false, fmt.Errorf("invalid launcher artifact for %s", target)
	}
	destination, err := os.Executable()
	if err != nil {
		return "", false, err
	}
	destination, err = filepath.EvalSymlinks(destination)
	if err != nil {
		return "", false, err
	}
	unlock, err := l.acquireInstallLock()
	if err != nil {
		return "", false, err
	}
	defer unlock()
	if err := l.installLauncher(serverURL, destination, release.Version, artifact); err != nil {
		return "", false, err
	}
	return destination, true, nil
}

func (l *launcher) installLauncher(serverURL, destination, version string, artifact launcherArtifact) error {
	candidate := destination + ".candidate"
	if runtime.GOOS == "windows" {
		candidate += ".exe"
	}
	// Do not reuse or follow an existing candidate path.
	if _, err := os.Lstat(candidate); !os.IsNotExist(err) {
		return fmt.Errorf("launcher candidate already exists: %s", candidate)
	}
	defer os.Remove(candidate)
	if err := l.download(serverURL+"/cli/launcher/"+artifact.File, candidate, manifestPackage{
		Size: artifact.Size, SHA256: artifact.SHA256,
	}); err != nil {
		return err
	}
	if err := os.Chmod(candidate, 0700); err != nil {
		return err
	}
	result, err := commandOutput(l.command(candidate, "--launcher-version"))
	if err != nil {
		return fmt.Errorf("launcher smoke check failed: %w", err)
	}
	if strings.TrimSpace(result) != version {
		return fmt.Errorf("launcher reported an unexpected version")
	}
	// Windows cannot replace a mapped executable in place. Rename the running
	// binary first, keep it for rollback, then activate the verified candidate.
	backup := destination + ".previous"
	if err := os.Remove(backup); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.Rename(destination, backup); err != nil {
		return err
	}
	if err := os.Rename(candidate, destination); err != nil {
		if rollback := os.Rename(backup, destination); rollback != nil {
			return fmt.Errorf("launcher activation failed: %v; rollback failed: %w", err, rollback)
		}
		return err
	}
	fmt.Fprintf(l.stdout, "Pop launcher %s installed.\n", version)
	return nil
}
