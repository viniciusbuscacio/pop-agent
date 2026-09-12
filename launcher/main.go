package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

const launcherVersion = "1.1.5"
const requestTimeout = 3 * time.Second
const npmRegistry = "https://packagefeedproxy.microsoft.io/npm/"

type manifest struct {
	Version                string          `json:"version"`
	MinimumNodeVersion     string          `json:"minimumNodeVersion"`
	MinimumLauncherVersion string          `json:"minimumLauncherVersion"`
	Package                manifestPackage `json:"package"`
}

type manifestPackage struct {
	URL    string `json:"url"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}

type profile struct {
	URL string `json:"url"`
}

type state struct {
	ActiveVersion   string `json:"activeVersion"`
	PreviousVersion string `json:"previousVersion,omitempty"`
}

type tools struct {
	node    string
	npm     string
	npmArgs []string
}

type launcher struct {
	stdin      io.Reader
	stdout     io.Writer
	stderr     io.Writer
	home       string
	configHome string
	http       *http.Client
	lookPath   func(string) (string, error)
	command    func(string, ...string) *exec.Cmd
	execute    func(string, string, []string) (int, error)
}

func main() {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Pop could not find your home directory:", err)
		os.Exit(1)
	}
	configHome := os.Getenv("XDG_CONFIG_HOME")
	if configHome == "" {
		configHome = filepath.Join(home, ".config")
	}
	l := &launcher{
		stdin:      os.Stdin,
		stdout:     os.Stdout,
		stderr:     os.Stderr,
		home:       home,
		configHome: configHome,
		http:       &http.Client{},
		lookPath:   exec.LookPath,
		command:    exec.Command,
		execute:    executeCLI,
	}
	code := l.run(os.Args[1:])
	os.Exit(code)
}

func (l *launcher) run(args []string) int {
	if hasArg(args, "--launcher-version") {
		fmt.Fprintln(l.stdout, launcherVersion)
		return 0
	}
	if len(args) > 0 && args[0] == "doctor" {
		return l.doctor(args)
	}
	if len(args) > 0 && args[0] == "runtime" {
		return l.runtimeCommand(args)
	}

	st, _ := l.readState()
	if (len(args) > 0 && args[0] == "version") || hasArg(args, "--version") || hasArg(args, "-v") {
		return l.startLocal(st, args)
	}

	profileName := option(args, "--server")
	if profileName == "" {
		profileName = "default"
	}
	serverURL, _ := l.profileURL(profileName)
	if len(args) >= 2 && args[0] == "login" {
		serverURL = args[1]
	}
	firstLogin := false
	if serverURL == "" {
		var err error
		serverURL, err = l.askServerURL()
		if err != nil {
			fmt.Fprintln(l.stderr, err)
			return 1
		}
		firstLogin = true
	}
	serverURL, err := normalizeServerURL(serverURL)
	if err != nil {
		fmt.Fprintf(l.stderr, "The configured Pop Agent server URL is invalid: %v\n", err)
		return 1
	}

	if len(args) == 0 || args[0] == "update" || hasArg(args, "--chat") {
		executable, updated, err := l.updateLauncher(serverURL)
		if err != nil {
			fmt.Fprintf(l.stderr, "Could not connect to or update the Pop launcher: %v. Run pop doctor for diagnostics.\n", err)
			return 1
		}
		if updated {
			nextArgs := args
			if firstLogin {
				nextArgs = []string{"login", serverURL}
			}
			command := l.command(executable, nextArgs...)
			command.Stdin, command.Stdout, command.Stderr = l.stdin, l.stdout, l.stderr
			if err := command.Run(); err != nil {
				if exit, ok := err.(*exec.ExitError); ok {
					return exit.ExitCode()
				}
				fmt.Fprintln(l.stderr, "Could not start updated launcher:", err)
				return 1
			}
			return 0
		}
	}

	m, err := l.fetchManifest(serverURL)
	if err != nil {
		fmt.Fprintf(l.stderr, "Could not connect to the Pop Agent server.\n\nServer: %s\nCause: %s\n\nCheck that the server is online and reachable, then run `pop` again.\nRun `pop doctor` for detailed diagnostics.\n", serverURL, describeNetworkError(err))
		return 1
	}

	localTools, err := l.dependencies(m.MinimumNodeVersion)
	if err != nil {
		fmt.Fprintln(l.stderr, err)
		return 1
	}

	updateCommand := len(args) > 0 && args[0] == "update"
	// Reinstall an equal version only for an explicit repair request.
	forceUpdate := updateCommand && hasArg(args, "--repair")
	if st.ActiveVersion == "" || compareVersions(st.ActiveVersion, m.Version) < 0 || forceUpdate {
		if err := l.installIfNeeded(serverURL, m, localTools, forceUpdate); err != nil {
			fmt.Fprintf(l.stderr, "Pop Agent CLI %s could not be installed: %v\n", m.Version, err)
			return 1
		}
		st, _ = l.readState()
	}
	if updateCommand {
		fmt.Fprintf(l.stdout, "Pop Agent CLI %s is ready.\n", st.ActiveVersion)
		return 0
	}

	launchArgs := args
	if firstLogin {
		launchArgs = []string{"login", serverURL}
	}
	return l.start(localTools.node, st, launchArgs)
}

func (l *launcher) doctor(args []string) int {
	profileName := option(args, "--server")
	if profileName == "" {
		profileName = "default"
	}
	fmt.Fprintf(l.stdout, "Pop launcher: %s (%s/%s)\n", launcherVersion, runtime.GOOS, runtime.GOARCH)
	st, _ := l.readState()
	if st.ActiveVersion == "" {
		fmt.Fprintln(l.stdout, "CLI: not installed")
	} else {
		fmt.Fprintf(l.stdout, "CLI: %s\n", st.ActiveVersion)
	}
	node, nodeErr := l.lookPath("node")
	if nodeErr != nil {
		fmt.Fprintln(l.stdout, "Node.js: not found (Pop Agent requires Node.js 22.19.0 or newer)")
	} else {
		version, err := commandOutput(l.command(node, "--version"))
		if err != nil {
			fmt.Fprintf(l.stdout, "Node.js: could not run (%v)\n", err)
		} else {
			fmt.Fprintf(l.stdout, "Node.js: %s (%s)\n", strings.TrimSpace(version), node)
		}
	}
	if managed, managedErr := l.readManagedRuntimeState(); managedErr == nil {
		directory := l.managedRuntimeDirectory(managed)
		version, npmVersion, validateErr := l.validateManagedRuntime(directory)
		if validateErr != nil {
			fmt.Fprintf(l.stdout, "Managed Node runtime: broken (%v)\n", validateErr)
		} else {
			fmt.Fprintf(l.stdout, "Managed Node runtime: v%s, npm %s (preferred for Pop CLI)\n", version, npmVersion)
		}
	} else if errors.Is(managedErr, os.ErrNotExist) {
		fmt.Fprintln(l.stdout, "Managed Node runtime: not installed")
	} else {
		fmt.Fprintf(l.stdout, "Managed Node runtime: invalid state (%v)\n", managedErr)
	}
	if runtime.GOOS == "windows" && nodeErr == nil {
		npmJS := filepath.Join(filepath.Dir(node), "node_modules", "npm", "bin", "npm-cli.js")
		if _, err := os.Stat(npmJS); err != nil {
			fmt.Fprintln(l.stdout, "npm: not found")
		} else {
			fmt.Fprintf(l.stdout, "npm: %s\n", npmJS)
		}
	} else if npm, err := l.lookPath("npm"); err != nil {
		fmt.Fprintln(l.stdout, "npm: not found")
	} else {
		fmt.Fprintf(l.stdout, "npm: %s\n", npm)
	}
	serverURL, ok := l.profileURL(profileName)
	if !ok {
		fmt.Fprintln(l.stdout, "Server: not configured")
		return 1
	}
	serverURL, err := normalizeServerURL(serverURL)
	if err != nil {
		fmt.Fprintf(l.stdout, "Server: invalid URL (%v)\n", err)
		return 1
	}
	m, err := l.fetchManifest(serverURL)
	if err != nil {
		fmt.Fprintf(l.stdout, "Server: unreachable (%s)\n", describeNetworkError(err))
		return 1
	}
	fmt.Fprintf(l.stdout, "Server: online (%s, CLI %s)\n", serverURL, m.Version)
	if _, err := l.dependencies(m.MinimumNodeVersion); err != nil {
		fmt.Fprintf(l.stdout, "Dependency check: %v\n", err)
		return 1
	}
	return 0
}

func (l *launcher) askServerURL() (string, error) {
	fmt.Fprintln(l.stdout, "No Pop Agent server is configured.")
	fmt.Fprint(l.stdout, "Server URL: ")
	line, err := bufio.NewReader(l.stdin).ReadString('\n')
	if err != nil && !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("could not read the server URL: %w", err)
	}
	if strings.TrimSpace(line) == "" {
		return "", errors.New("a server URL is required")
	}
	return line, nil
}

func (l *launcher) fetchManifest(serverURL string) (manifest, error) {
	ctx, cancel := context.WithTimeout(context.Background(), requestTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, serverURL+"/cli/manifest.json", nil)
	if err != nil {
		return manifest{}, err
	}
	req.Header.Set("User-Agent", "pop-launcher/"+launcherVersion)
	response, err := l.http.Do(req)
	if err != nil {
		return manifest{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return manifest{}, fmt.Errorf("server returned HTTP %d", response.StatusCode)
	}
	var m manifest
	if err := json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&m); err != nil {
		return manifest{}, fmt.Errorf("invalid CLI manifest: %w", err)
	}
	if !validVersion(m.Version) || !validVersion(m.MinimumNodeVersion) || !validVersion(m.MinimumLauncherVersion) || m.Package.URL == "" || m.Package.Size <= 0 || len(m.Package.SHA256) != 64 {
		return manifest{}, errors.New("server returned an incomplete CLI manifest")
	}
	if compareVersions(launcherVersion, m.MinimumLauncherVersion) < 0 {
		return manifest{}, fmt.Errorf("Pop launcher %s is too old; this server requires %s or newer. Reinstall the launcher from %s/install.sh", launcherVersion, m.MinimumLauncherVersion, serverURL)
	}
	return m, nil
}

func (l *launcher) dependencies(minimum string) (tools, error) {
	if managed, err := l.managedTools(minimum); err == nil {
		return managed, nil
	}
	node, err := l.lookPath("node")
	if err != nil {
		return tools{}, fmt.Errorf("Pop Agent requires Node.js %s or newer.\n\nNode.js was not found on this computer.\nInstall it from https://nodejs.org/ and run `pop` again", minimum)
	}
	text, err := commandOutput(l.command(node, "--version"))
	if err != nil {
		return tools{}, fmt.Errorf("Node.js was found at %s but could not be started: %w", node, err)
	}
	installed := strings.TrimPrefix(strings.TrimSpace(text), "v")
	if !validVersion(installed) || compareVersions(installed, minimum) < 0 {
		return tools{}, fmt.Errorf("Pop Agent requires Node.js >=%s.\nInstalled version: %s.\nUpdate Node.js and run `pop` again", minimum, installed)
	}
	if runtime.GOOS == "windows" {
		npmJS := filepath.Join(filepath.Dir(node), "node_modules", "npm", "bin", "npm-cli.js")
		if _, err := os.Stat(npmJS); err != nil {
			return tools{}, errors.New("Node.js is installed, but npm was not found beside it.\nInstall npm and run `pop` again")
		}
		return tools{node: node, npm: node, npmArgs: []string{npmJS}}, nil
	}
	npm, err := l.lookPath("npm")
	if err != nil {
		return tools{}, errors.New("Node.js is installed, but npm was not found.\nInstall npm and run `pop` again")
	}
	return tools{node: node, npm: npm}, nil
}

func (l *launcher) installIfNeeded(serverURL string, m manifest, localTools tools, force bool) error {
	release, err := l.acquireInstallLock()
	if err != nil {
		return err
	}
	defer release()
	current, _ := l.readState()
	if current.ActiveVersion != "" && (compareVersions(current.ActiveVersion, m.Version) > 0 || (!force && compareVersions(current.ActiveVersion, m.Version) == 0)) {
		return nil
	}
	return l.install(serverURL, m, localTools, current)
}

func (l *launcher) acquireInstallLock() (func(), error) {
	dir := filepath.Join(l.home, ".pop")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	path := filepath.Join(dir, "update.lock")
	deadline := time.Now().Add(2 * time.Minute)
	for {
		file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if err == nil {
			_, _ = fmt.Fprintf(file, "%d\n", os.Getpid())
			_ = file.Close()
			return func() { _ = os.Remove(path) }, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return nil, err
		}
		if info, statErr := os.Stat(path); statErr == nil && time.Since(info.ModTime()) > 30*time.Minute {
			_ = os.Remove(path)
			continue
		}
		if time.Now().After(deadline) {
			return nil, errors.New("another Pop CLI update did not finish within 2 minutes")
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func (l *launcher) install(serverURL string, m manifest, localTools tools, previous state) error {
	packageURL, err := resolvePackageURL(serverURL, m.Package.URL)
	if err != nil {
		return err
	}
	root := filepath.Join(l.home, ".pop", "cli")
	if err := os.MkdirAll(root, 0700); err != nil {
		return err
	}
	// npm decides whether a local argument is a package file from its final
	// extension; keep .tgz last even while the download is temporary.
	archive := filepath.Join(root, ".cli-"+m.Version+".tmp.tgz")
	defer os.Remove(archive)
	if previous.ActiveVersion == "" {
		fmt.Fprintf(l.stdout, "Installing Pop Agent CLI %s...\n", m.Version)
	} else {
		fmt.Fprintf(l.stdout, "Updating Pop Agent CLI %s → %s...\n", previous.ActiveVersion, m.Version)
	}
	if err := l.download(packageURL, archive, m.Package); err != nil {
		return err
	}

	staging := filepath.Join(root, ".staging-"+m.Version)
	candidate := filepath.Join(root, m.Version)
	_ = os.RemoveAll(staging)
	if err := os.MkdirAll(staging, 0700); err != nil {
		return err
	}
	defer os.RemoveAll(staging)
	npmArgs := append(append([]string{}, localTools.npmArgs...), "install", "--prefix", staging, "--registry", npmRegistry, "--omit=dev", "--no-audit", "--no-fund", "--no-update-notifier", "--loglevel=error", archive)
	cmd := l.command(localTools.npm, npmArgs...)
	cmd.Stdout, cmd.Stderr = l.stdout, l.stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("npm installation failed: %w", err)
	}
	entry := cliEntry(staging)
	got, err := commandOutput(l.command(localTools.node, entry, "--version"))
	if err != nil {
		return fmt.Errorf("the installed CLI failed its smoke check: %w", err)
	}
	if strings.TrimSpace(got) != m.Version {
		return fmt.Errorf("the installed CLI reported version %q, expected %q", strings.TrimSpace(got), m.Version)
	}
	if err := replaceDirectory(staging, candidate); err != nil {
		return fmt.Errorf("could not activate the installed files: %w", err)
	}
	if err := l.writeState(state{ActiveVersion: m.Version, PreviousVersion: previous.ActiveVersion}); err != nil {
		return fmt.Errorf("could not activate CLI %s: %w", m.Version, err)
	}
	fmt.Fprintln(l.stdout, "Installation complete.")
	return nil
}

func (l *launcher) download(packageURL, destination string, expected manifestPackage) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, packageURL, nil)
	if err != nil {
		return err
	}
	response, err := l.http.Do(req)
	if err != nil {
		return fmt.Errorf("download failed: %w", err)
	}
	defer response.Body.Close()
	expectedURL, parseErr := url.Parse(packageURL)
	if parseErr != nil || response.Request.URL.Scheme != expectedURL.Scheme || response.Request.URL.Host != expectedURL.Host {
		return errors.New("package download redirected outside its trusted source")
	}
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("package download returned HTTP %d", response.StatusCode)
	}
	file, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	hash := sha256.New()
	written, copyErr := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, expected.Size+1))
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written != expected.Size {
		return fmt.Errorf("package size mismatch: downloaded %d bytes, expected %d", written, expected.Size)
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(actual, expected.SHA256) {
		return fmt.Errorf("package checksum mismatch: got %s, expected %s", actual, expected.SHA256)
	}
	return nil
}

func (l *launcher) startLocal(st state, args []string) int {
	if managed, err := l.managedTools("22.19.0"); err == nil {
		return l.start(managed.node, st, args)
	}
	node, err := l.lookPath("node")
	if err != nil {
		fmt.Fprintln(l.stderr, "Node.js was not found. Pop Agent requires Node.js 22.19.0 or newer.")
		return 1
	}
	return l.start(node, st, args)
}

func (l *launcher) start(node string, st state, args []string) int {
	if st.ActiveVersion == "" {
		fmt.Fprintln(l.stderr, "No Pop Agent CLI is installed. Connect to the server by running `pop`.")
		return 1
	}
	entry := cliEntry(filepath.Join(l.home, ".pop", "cli", st.ActiveVersion))
	if _, err := os.Stat(entry); err != nil {
		fmt.Fprintf(l.stderr, "Pop Agent CLI %s is incomplete. Run `pop update` to repair it.\n", st.ActiveVersion)
		return 1
	}
	code, err := l.execute(node, entry, args)
	if err != nil {
		fmt.Fprintln(l.stderr, "Could not start Pop Agent CLI:", err)
		return 1
	}
	return code
}

func (l *launcher) profileURL(name string) (string, bool) {
	bytes, err := os.ReadFile(filepath.Join(l.configHome, "pop-agent", "profiles.json"))
	if err != nil {
		return "", false
	}
	profiles := map[string]profile{}
	if json.Unmarshal(bytes, &profiles) != nil {
		return "", false
	}
	p, ok := profiles[name]
	return p.URL, ok && p.URL != ""
}

func (l *launcher) readState() (state, error) {
	bytes, err := os.ReadFile(filepath.Join(l.home, ".pop", "state.json"))
	if err != nil {
		return state{}, err
	}
	var st state
	err = json.Unmarshal(bytes, &st)
	return st, err
}

func (l *launcher) writeState(st state) error {
	dir := filepath.Join(l.home, ".pop")
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	bytes, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	temporary := filepath.Join(dir, ".state.json.tmp")
	if err := os.WriteFile(temporary, append(bytes, '\n'), 0600); err != nil {
		return err
	}
	return atomicReplace(temporary, filepath.Join(dir, "state.json"))
}

func replaceDirectory(staging, candidate string) error {
	backup := candidate + ".previous"
	_ = os.RemoveAll(backup)
	if _, err := os.Stat(candidate); err == nil {
		if err := os.Rename(candidate, backup); err != nil {
			return err
		}
	}
	if err := os.Rename(staging, candidate); err != nil {
		_ = os.Rename(backup, candidate)
		return err
	}
	return os.RemoveAll(backup)
}

func cliEntry(prefix string) string {
	return filepath.Join(prefix, "node_modules", "pop-agent", "dist", "main.js")
}

func resolvePackageURL(serverURL, packagePath string) (string, error) {
	base, err := url.Parse(serverURL)
	if err != nil {
		return "", err
	}
	reference, err := url.Parse(packagePath)
	if err != nil {
		return "", err
	}
	resolved := base.ResolveReference(reference)
	if resolved.Scheme != base.Scheme || resolved.Host != base.Host {
		return "", errors.New("CLI manifest points outside the configured server")
	}
	return resolved.String(), nil
}

func normalizeServerURL(raw string) (string, error) {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", errors.New("expected an http(s) origin such as https://pop.example")
	}
	if parsed.Path != "" {
		return "", errors.New("the server URL cannot contain a path")
	}
	if parsed.Scheme == "http" && !isLoopbackHost(parsed.Hostname()) {
		return "", errors.New("HTTP is allowed only for a loopback server; use HTTPS for remote Pop Agent servers")
	}
	return parsed.String(), nil
}

func isLoopbackHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func compareVersions(a, b string) int {
	left, right := versionParts(a), versionParts(b)
	for i := 0; i < 3; i++ {
		if left[i] < right[i] {
			return -1
		}
		if left[i] > right[i] {
			return 1
		}
	}
	return 0
}

func versionParts(value string) [3]int {
	var result [3]int
	parts := strings.Split(strings.TrimPrefix(value, "v"), ".")
	for i := 0; i < len(parts) && i < 3; i++ {
		result[i], _ = strconv.Atoi(parts[i])
	}
	return result
}

func validVersion(value string) bool {
	parts := strings.Split(value, ".")
	if len(parts) != 3 {
		return false
	}
	for _, part := range parts {
		if part == "" {
			return false
		}
		if _, err := strconv.Atoi(part); err != nil {
			return false
		}
	}
	return true
}

func option(args []string, name string) string {
	for i := 0; i+1 < len(args); i++ {
		if args[i] == name {
			return args[i+1]
		}
	}
	return ""
}

func hasArg(args []string, names ...string) bool {
	for _, arg := range args {
		for _, name := range names {
			if arg == name {
				return true
			}
		}
	}
	return false
}

func commandOutput(cmd *exec.Cmd) (string, error) {
	bytes, err := cmd.Output()
	return string(bytes), err
}

func describeNetworkError(err error) string {
	if errors.Is(err, context.DeadlineExceeded) || os.IsTimeout(err) {
		return "connection timed out after 3 seconds"
	}
	return err.Error()
}
