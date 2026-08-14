package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const maximumRuntimeExpansion = int64(512 << 20)
const maximumRuntimeFiles = 50_000

type runtimeManifest struct {
	Version                string                     `json:"version"`
	MinimumLauncherVersion string                     `json:"minimumLauncherVersion"`
	Packages               map[string]manifestPackage `json:"packages"`
}

type managedRuntimeState struct {
	SchemaVersion    int    `json:"schemaVersion"`
	InstalledVersion string `json:"installedVersion"`
	Platform         string `json:"platform"`
	Arch             string `json:"arch"`
	SHA256           string `json:"sha256"`
}

func (l *launcher) runtimeCommand(args []string) int {
	if len(args) < 2 {
		fmt.Fprintln(l.stderr, "Usage: pop runtime install | doctor")
		return 1
	}
	switch args[1] {
	case "doctor":
		return l.runtimeDoctor()
	case "install":
		serverURL, ok := l.profileURL("default")
		if !ok {
			fmt.Fprintln(l.stderr, "No Pop Agent server is configured. Run `pop login <server-url>` first.")
			return 1
		}
		serverURL, err := normalizeServerURL(serverURL)
		if err != nil {
			fmt.Fprintf(l.stderr, "The configured Pop Agent server URL is invalid: %v\n", err)
			return 1
		}
		release, err := l.fetchRuntimeManifest(serverURL)
		if err != nil {
			fmt.Fprintf(l.stderr, "Could not obtain the managed Node runtime manifest: %v\n", err)
			return 1
		}
		unlock, err := l.acquireInstallLock()
		if err != nil {
			fmt.Fprintln(l.stderr, err)
			return 1
		}
		defer unlock()
		if err := l.installManagedRuntime(serverURL, release); err != nil {
			fmt.Fprintf(l.stderr, "Managed Node runtime %s could not be installed: %v\n", release.Version, err)
			return 1
		}
		fmt.Fprintf(l.stdout, "Managed Node runtime %s is ready. The current CLI still uses its existing Node until migration is enabled.\n", release.Version)
		return 0
	default:
		fmt.Fprintf(l.stderr, "Unknown runtime command %q. Use install or doctor.\n", args[1])
		return 1
	}
}

func (l *launcher) fetchRuntimeManifest(serverURL string) (runtimeManifest, error) {
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serverURL+"/runtime/node/manifest.json", nil)
	if err != nil {
		return runtimeManifest{}, err
	}
	req.Header.Set("User-Agent", "pop-launcher/"+launcherVersion)
	response, err := l.http.Do(req)
	if err != nil {
		return runtimeManifest{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return runtimeManifest{}, fmt.Errorf("server returned HTTP %d", response.StatusCode)
	}
	var release runtimeManifest
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&release); err != nil {
		return runtimeManifest{}, fmt.Errorf("invalid managed Node runtime manifest: %w", err)
	}
	if !validVersion(release.Version) || !validVersion(release.MinimumLauncherVersion) {
		return runtimeManifest{}, errors.New("server returned an incomplete managed Node runtime manifest")
	}
	if compareVersions(launcherVersion, release.MinimumLauncherVersion) < 0 {
		return runtimeManifest{}, fmt.Errorf("Pop launcher %s is too old; this runtime requires %s or newer", launcherVersion, release.MinimumLauncherVersion)
	}
	artifact, ok := release.Packages[runtime.GOOS+"-"+runtime.GOARCH]
	if !ok || artifact.URL == "" || artifact.Size <= 0 || !validSHA256(artifact.SHA256) {
		return runtimeManifest{}, fmt.Errorf("managed Node runtime %s does not support %s/%s", release.Version, runtime.GOOS, runtime.GOARCH)
	}
	return release, nil
}

func (l *launcher) installManagedRuntime(serverURL string, release runtimeManifest) error {
	target := runtime.GOOS + "-" + runtime.GOARCH
	artifact, ok := release.Packages[target]
	if !ok {
		return fmt.Errorf("unsupported platform %s", target)
	}
	if current, err := l.readManagedRuntimeState(); err == nil &&
		current.InstalledVersion == release.Version &&
		current.Platform == runtime.GOOS && current.Arch == runtime.GOARCH &&
		strings.EqualFold(current.SHA256, artifact.SHA256) {
		if _, _, err := l.validateManagedRuntime(l.managedRuntimeDirectory(current)); err == nil {
			return nil
		}
	}

	packageURL, err := resolvePackageURL(serverURL, artifact.URL)
	if err != nil {
		return err
	}
	root := l.managedRuntimeRoot()
	versions := filepath.Join(root, "versions")
	if err := os.MkdirAll(versions, 0o700); err != nil {
		return err
	}
	archive := filepath.Join(root, ".node-"+release.Version+".tmp.tar.gz")
	_ = os.Remove(archive)
	defer os.Remove(archive)
	fmt.Fprintf(l.stdout, "Installing managed Node runtime %s for %s...\n", release.Version, target)
	if err := l.download(packageURL, archive, artifact); err != nil {
		return err
	}

	staging := filepath.Join(root, ".staging-"+release.Version+"-"+target)
	candidate := filepath.Join(versions, release.Version+"-"+target)
	_ = os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0o700); err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	if err := extractNodeTarGz(archive, staging); err != nil {
		return fmt.Errorf("extract runtime: %w", err)
	}
	nodeVersion, _, err := l.validateManagedRuntime(staging)
	if err != nil {
		return err
	}
	if nodeVersion != release.Version {
		return fmt.Errorf("runtime reported Node %s, expected %s", nodeVersion, release.Version)
	}
	if err := replaceDirectory(staging, candidate); err != nil {
		return fmt.Errorf("activate runtime files: %w", err)
	}
	state := managedRuntimeState{
		SchemaVersion: 1, InstalledVersion: release.Version,
		Platform: runtime.GOOS, Arch: runtime.GOARCH, SHA256: artifact.SHA256,
	}
	if err := l.writeManagedRuntimeState(state); err != nil {
		return fmt.Errorf("record installed runtime: %w", err)
	}
	return nil
}

func (l *launcher) validateManagedRuntime(directory string) (string, string, error) {
	node := managedNodePath(directory)
	text, err := commandOutput(l.command(node, "--version"))
	if err != nil {
		return "", "", fmt.Errorf("managed Node failed its smoke check: %w", err)
	}
	version := strings.TrimPrefix(strings.TrimSpace(text), "v")
	if !validVersion(version) {
		return "", "", fmt.Errorf("managed Node returned invalid version %q", strings.TrimSpace(text))
	}
	npmCLI := filepath.Join(directory, "lib", "node_modules", "npm", "bin", "npm-cli.js")
	if runtime.GOOS == "windows" {
		npmCLI = filepath.Join(directory, "node_modules", "npm", "bin", "npm-cli.js")
	}
	if _, err := os.Stat(npmCLI); err != nil {
		return "", "", fmt.Errorf("managed runtime does not contain npm-cli.js: %w", err)
	}
	npmVersion, err := commandOutput(l.command(node, npmCLI, "--version"))
	if err != nil {
		return "", "", fmt.Errorf("managed npm failed its smoke check: %w", err)
	}
	return version, strings.TrimSpace(npmVersion), nil
}

func (l *launcher) runtimeDoctor() int {
	state, err := l.readManagedRuntimeState()
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			fmt.Fprintln(l.stdout, "Managed Node runtime: not installed")
			return 1
		}
		fmt.Fprintf(l.stdout, "Managed Node runtime: invalid state (%v)\n", err)
		return 1
	}
	directory := l.managedRuntimeDirectory(state)
	nodeVersion, npmVersion, err := l.validateManagedRuntime(directory)
	if err != nil {
		fmt.Fprintf(l.stdout, "Managed Node runtime: broken (%v)\n", err)
		return 1
	}
	fmt.Fprintf(l.stdout, "Managed Node runtime: v%s (%s/%s)\n", nodeVersion, state.Platform, state.Arch)
	fmt.Fprintf(l.stdout, "npm: %s\n", npmVersion)
	fmt.Fprintf(l.stdout, "Path: %s\n", managedNodePath(directory))
	fmt.Fprintln(l.stdout, "Activation: staged pilot; the CLI still uses its existing Node")
	return 0
}

func (l *launcher) managedRuntimeRoot() string {
	return filepath.Join(l.home, ".pop", "runtime", "node")
}

func (l *launcher) managedRuntimeDirectory(state managedRuntimeState) string {
	return filepath.Join(l.managedRuntimeRoot(), "versions", state.InstalledVersion+"-"+state.Platform+"-"+state.Arch)
}

func managedNodePath(directory string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(directory, "node.exe")
	}
	return filepath.Join(directory, "bin", "node")
}

func (l *launcher) readManagedRuntimeState() (managedRuntimeState, error) {
	bytes, err := os.ReadFile(filepath.Join(l.managedRuntimeRoot(), "state.json"))
	if err != nil {
		return managedRuntimeState{}, err
	}
	var state managedRuntimeState
	if err := json.Unmarshal(bytes, &state); err != nil {
		return managedRuntimeState{}, err
	}
	if state.SchemaVersion != 1 || !validVersion(state.InstalledVersion) ||
		state.Platform != runtime.GOOS || state.Arch != runtime.GOARCH || !validSHA256(state.SHA256) {
		return managedRuntimeState{}, errors.New("incomplete managed runtime state")
	}
	return state, nil
}

func (l *launcher) writeManagedRuntimeState(state managedRuntimeState) error {
	root := l.managedRuntimeRoot()
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return err
	}
	temporary := filepath.Join(root, ".state.json.tmp")
	if err := os.WriteFile(temporary, append(bytes, '\n'), 0o600); err != nil {
		return err
	}
	return atomicReplace(temporary, filepath.Join(root, "state.json"))
}

func extractNodeTarGz(archive, destination string) error {
	file, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer file.Close()
	compressed, err := gzip.NewReader(file)
	if err != nil {
		return err
	}
	defer compressed.Close()
	reader := tar.NewReader(compressed)
	var root string
	var expanded int64
	files := 0
	for {
		header, err := reader.Next()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return err
		}
		clean := filepath.ToSlash(filepath.Clean(header.Name))
		if clean == "." || strings.HasPrefix(clean, "/") || clean == ".." || strings.HasPrefix(clean, "../") {
			return fmt.Errorf("unsafe archive path %q", header.Name)
		}
		parts := strings.Split(clean, "/")
		if root == "" {
			root = parts[0]
		}
		if parts[0] != root {
			return errors.New("runtime archive has more than one root directory")
		}
		if len(parts) == 1 {
			if header.Typeflag != tar.TypeDir {
				return errors.New("runtime archive root is not a directory")
			}
			continue
		}
		relative := filepath.FromSlash(strings.Join(parts[1:], "/"))
		target := filepath.Join(destination, relative)
		if !withinDirectory(destination, target) {
			return fmt.Errorf("archive path escapes staging: %q", header.Name)
		}
		files++
		if files > maximumRuntimeFiles {
			return errors.New("runtime archive contains too many entries")
		}
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg, tar.TypeRegA:
			if header.Size < 0 || expanded > maximumRuntimeExpansion-header.Size {
				return errors.New("runtime archive exceeds expanded size limit")
			}
			expanded += header.Size
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			mode := os.FileMode(0o644)
			if header.Mode&0o111 != 0 {
				mode = 0o755
			}
			output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
			if err != nil {
				return err
			}
			written, copyErr := io.CopyN(output, reader, header.Size)
			closeErr := output.Close()
			if copyErr != nil || written != header.Size {
				if copyErr != nil {
					return copyErr
				}
				return io.ErrUnexpectedEOF
			}
			if closeErr != nil {
				return closeErr
			}
		case tar.TypeSymlink:
			// npm/npx convenience links are unnecessary: the launcher invokes
			// npm-cli.js through Node directly. Skipping every symlink keeps the
			// extraction boundary simple and prevents links escaping staging.
			continue
		default:
			return fmt.Errorf("unsupported archive entry type %d for %q", header.Typeflag, header.Name)
		}
	}
	if root == "" {
		return errors.New("runtime archive is empty")
	}
	return nil
}

func withinDirectory(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)) && !filepath.IsAbs(relative)
}

func validSHA256(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size
}
