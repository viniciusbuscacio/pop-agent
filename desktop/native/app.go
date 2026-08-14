package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/clidetect"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/config"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/desktop"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/dialog"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/keychain"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/loginitem"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/nodedetect"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/relaunch"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/serverclient"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/status"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/tray"
)

type ManagerState struct {
	ServerURL       string          `json:"serverURL"`
	ServerCheckedAt time.Time       `json:"-"`
	Status          status.Snapshot `json:"status"`
}

type App struct {
	cancel      context.CancelFunc
	showDesktop func() error

	mu                    sync.Mutex
	configPath            string
	config                config.Config
	state                 status.Snapshot
	serverCheckedAt       time.Time
	nodeDetail            string
	nodeVersion           string
	nodePath              string
	cliDetail             string
	cliVersion            string
	cliPath               string
	cliEntryPath          string
	serverVersion         string
	desktopDetail         string
	desktopVersion        string
	desktopPath           string
	desktopRelease        serverclient.DesktopRelease
	desktopUpdateVersion  string
	desktopUpdateRunning  bool
	confirmDesktopUpdate  func(string, string, string) bool
	installDesktopPackage func(string, string, string) error
	relaunchDesktop       func(string, int, int) error
	stopAfterUpdate       func()

	keychainMu sync.Mutex
	keychain   keychain.Store
	server     *serverclient.Client
}

func NewApp() *App {
	desktopPath, _ := desktop.DefaultInstallPath()
	a := &App{
		state:                 status.Initial(),
		nodeDetail:            "Checking",
		nodeVersion:           "Checking",
		nodePath:              "Searching common locations",
		cliDetail:             "Checking",
		cliVersion:            "Checking",
		cliPath:               "Searching common locations",
		desktopDetail:         "Not installed",
		desktopVersion:        "Not installed",
		desktopPath:           desktopPath,
		confirmDesktopUpdate:  dialog.Confirm,
		installDesktopPackage: desktop.InstallPackage,
		relaunchDesktop:       relaunch.Start,
		keychain:              keychain.New(),
		server:                serverclient.New(),
	}
	a.stopAfterUpdate = a.quit
	return a
}

func (a *App) startup(ctx context.Context, cancel context.CancelFunc) error {
	a.cancel = cancel

	path, err := config.DefaultPath()
	if err != nil {
		return err
	}
	a.configPath = path
	a.config, err = config.LoadOrCreate(path)
	if err != nil {
		return err
	}

	if enabled, enabledErr := loginitem.Enabled(); enabledErr == nil && enabled != a.config.StartAtLogin {
		a.config.StartAtLogin = enabled
		if saveErr := config.Save(a.configPath, a.config); saveErr != nil {
			fmt.Fprintln(os.Stderr, "pop-desktop-tray: persist login item state:", saveErr)
		}
	}

	if err := tray.Install(tray.Callbacks{
		CheckUpdates:       a.checkUpdates,
		CheckServer:        a.checkServer,
		CheckDesktop:       a.checkDesktop,
		InstallDesktop:     a.installDesktop,
		OpenDesktop:        a.openDesktop,
		CheckNode:          a.checkNode,
		CheckCLI:           a.checkCLI,
		UpdateCLI:          a.updateCLI,
		ConfigureServer:    a.configureServer,
		Diagnostics:        a.showDiagnostics,
		ToggleStartAtLogin: a.toggleStartAtLogin,
		Quit:               a.quit,
	}); err != nil {
		return err
	}

	a.publish(a.snapshot())
	go a.detectDesktop()
	go a.detectNode(ctx)
	if a.config.ServerURL == "" {
		return nil
	}
	a.setServerState(status.Connecting, "Connecting")
	go a.restoreSession(ctx)
	return nil
}

func (a *App) shutdown() {
	tray.Remove()
}

func (a *App) quit() {
	if a.cancel != nil {
		a.cancel()
	}
	tray.Stop()
}

func (a *App) configureServer() {
	currentURL := a.snapshot().ServerURL
	serverURL, password, ok := dialog.PromptServer(currentURL)
	if !ok {
		return
	}
	go func() {
		state, err := a.Connect(serverURL, password)
		if err != nil {
			dialog.ShowError("Could not connect", userFacingError(err))
			return
		}
		dialog.ShowInfo("Server connected", "Pop Desktop is connected to "+state.ServerURL+".")
	}()
}

func (a *App) checkServer() {
	go func() {
		state, err := a.CheckServer()
		if err != nil {
			dialog.ShowError("Server check failed", userFacingError(err))
			return
		}
		dialog.ShowInfo("Server connected", "Pop Desktop is connected to "+state.ServerURL+".")
	}()
}

func (a *App) checkUpdates() {
	go func() {
		a.detectDesktop()
		a.refreshServerVersion()
		a.refreshDesktopRelease()
		a.detectNode(context.Background())
	}()
}

func (a *App) checkDesktop() {
	go func() {
		a.detectDesktop()
		a.refreshDesktopRelease()
	}()
}

func (a *App) openDesktop() {
	if a.showDesktop == nil {
		return
	}
	if err := a.showDesktop(); err != nil {
		dialog.ShowError("Could not open Pop Desktop", err.Error())
	}
}

func (a *App) installDesktop() {
	a.mu.Lock()
	release := a.desktopRelease
	origin := a.config.ServerURL
	a.mu.Unlock()
	if release.Version == "" || origin == "" {
		dialog.ShowError("Could not install Pop Desktop", "Connect to a server that publishes Pop Desktop and check again first.")
		return
	}
	go a.downloadAndInstallDesktop(release, false)
}

func (a *App) prepareDesktopUpdate(release serverclient.DesktopRelease) {
	a.mu.Lock()
	path := a.desktopPath
	a.mu.Unlock()
	installation := desktop.Detect(path)
	if installation.Err != nil || (installation.Installed && compareDesktopVersions(installation.Version, release.Version) >= 0) {
		return
	}
	a.downloadAndInstallDesktop(release, true)
}

func (a *App) downloadAndInstallDesktop(release serverclient.DesktopRelease, confirm bool) {
	if !a.beginDesktopUpdate(release.Version, !confirm) {
		return
	}
	defer a.finishDesktopUpdate()

	a.mu.Lock()
	origin := a.config.ServerURL
	path := a.desktopPath
	a.mu.Unlock()
	if origin == "" || path == "" {
		return
	}
	a.setDesktopState(status.Checking, "Downloading update", "Downloading update", "v"+release.Version, path)
	token, err := a.getToken(origin)
	if err != nil {
		a.detectDesktop()
		if !confirm {
			dialog.ShowError("Pop Desktop update failed", userFacingError(err))
		}
		return
	}
	packageFile, err := os.CreateTemp("", "pop-desktop-*.zip")
	if err != nil {
		a.detectDesktop()
		dialog.ShowError("Pop Desktop update failed", err.Error())
		return
	}
	packagePath := packageFile.Name()
	defer os.Remove(packagePath)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	renewed, downloadErr := a.server.DownloadDesktop(ctx, origin, token, release, packageFile)
	closeErr := packageFile.Close()
	if downloadErr == nil {
		downloadErr = closeErr
	}
	if downloadErr != nil {
		a.detectDesktop()
		dialog.ShowError("Pop Desktop update failed", userFacingError(downloadErr))
		return
	}
	if renewed != "" {
		_ = a.setToken(origin, renewed)
	}
	if confirm && !a.confirmDesktopUpdate(
		"Pop Desktop update ready",
		"Pop Desktop "+release.Version+" has been downloaded and verified. Install it and restart now?",
		"Install and Restart",
	) {
		a.detectDesktop()
		return
	}
	if err := a.installDesktopPackage(packagePath, path, release.Version); err != nil {
		a.detectDesktop()
		dialog.ShowError("Pop Desktop update failed", err.Error())
		return
	}
	if err := a.relaunchDesktop(path, os.Getppid(), os.Getpid()); err != nil {
		a.detectDesktop()
		dialog.ShowError("Pop Desktop was installed but could not restart", err.Error())
		return
	}
	a.stopAfterUpdate()
}

func (a *App) beginDesktopUpdate(version string, force bool) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.desktopUpdateRunning || (!force && a.desktopUpdateVersion == version) {
		return false
	}
	a.desktopUpdateRunning = true
	a.desktopUpdateVersion = version
	return true
}

func (a *App) finishDesktopUpdate() {
	a.mu.Lock()
	a.desktopUpdateRunning = false
	a.mu.Unlock()
}

func (a *App) checkNode() {
	go a.detectNode(context.Background())
}

func (a *App) checkCLI() {
	a.mu.Lock()
	nodePath := a.nodePath
	a.mu.Unlock()
	go a.detectCLI(context.Background(), nodePath)
}

func (a *App) updateCLI() {
	a.mu.Lock()
	nodePath := a.nodePath
	entryPath := a.cliEntryPath
	cliDisplay := a.cliVersion
	cliVersion := strings.TrimPrefix(cliDisplay, "v")
	cliPath := a.cliPath
	serverVersion := a.serverVersion
	origin := a.config.ServerURL
	a.mu.Unlock()
	if nodePath == "" {
		dialog.ShowError("Could not install Pop CLI", "Detect a compatible Node first.")
		return
	}
	if serverVersion == "" || origin == "" {
		dialog.ShowError("Could not install Pop CLI", "Connect to the Pop Agent server and check again first.")
		return
	}
	if entryPath != "" && cliVersion == serverVersion {
		dialog.ShowInfo("Pop CLI", "Pop CLI "+serverVersion+" is already up to date.")
		return
	}
	go func() {
		a.setCLIState(status.Checking, "Updating", "Updating", cliDisplay, cliPath, entryPath)
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		var command *exec.Cmd
		if entryPath != "" {
			command = exec.CommandContext(ctx, nodePath, entryPath, "update")
		} else {
			npmCLI, err := npmCLIPath(nodePath)
			if err != nil {
				a.detectCLI(context.Background(), nodePath)
				dialog.ShowError("Pop CLI install failed", err.Error())
				return
			}
			packageURL := origin + "/cli-" + serverVersion + ".tgz"
			command = exec.CommandContext(ctx, nodePath, npmCLI, "install", "--global", packageURL)
		}
		command.Env = envWithPath(filepath.Dir(nodePath), os.Environ())
		output, err := command.CombinedOutput()
		if err != nil {
			a.detectCLI(context.Background(), nodePath)
			message := strings.TrimSpace(string(output))
			if message == "" {
				message = err.Error()
			}
			dialog.ShowError("Pop CLI install failed", message)
			return
		}
		a.detectCLI(context.Background(), nodePath)
		dialog.ShowInfo("Pop CLI updated", "Pop CLI "+serverVersion+" was installed. Restart open CLI sessions.")
	}()
}

func (a *App) showDiagnostics() {
	state := a.snapshot()
	a.mu.Lock()
	nodePath := a.nodePath
	a.mu.Unlock()
	message := fmt.Sprintf(
		"Server: %s\nDesktop: %s\nCLI: %s\nNode: %s\nNode path: %s\n\nConfiguration: %s",
		state.Status.Server.Text,
		state.Status.Desktop.Text,
		state.Status.CLI.Text,
		state.Status.Node.Text,
		nodePath,
		a.configPath,
	)
	dialog.ShowInfo("Pop Desktop Diagnostics", message)
}

func (a *App) toggleStartAtLogin() {
	a.mu.Lock()
	next := !a.config.StartAtLogin
	a.mu.Unlock()

	if err := loginitem.SetEnabled(next); err != nil {
		dialog.ShowError("Could not update Login Items", err.Error())
		return
	}

	a.mu.Lock()
	cfg := a.config
	cfg.StartAtLogin = next
	path := a.configPath
	a.mu.Unlock()
	if err := config.Save(path, cfg); err != nil {
		_ = loginitem.SetEnabled(!next)
		dialog.ShowError("Could not save the setting", err.Error())
		return
	}
	a.mu.Lock()
	a.config = cfg
	a.mu.Unlock()
	a.publish(a.snapshot())
}

// Connect authenticates with the normal Pop Agent password. The password is
// used for this request only; the resulting session token goes to Keychain.
func (a *App) Connect(rawURL, password string) (ManagerState, error) {
	origin, err := serverclient.NormalizeURL(rawURL)
	if err != nil {
		return a.snapshot(), err
	}
	if password == "" {
		return a.snapshot(), errors.New("Enter your Pop Agent password.")
	}
	a.mu.Lock()
	if a.config.ServerURL != origin {
		a.desktopRelease = serverclient.DesktopRelease{}
		a.serverVersion = ""
	}
	a.mu.Unlock()
	if err := a.persistServerURL(origin); err != nil {
		return a.snapshot(), err
	}
	a.setServerState(status.Connecting, "Connecting")

	token, err := a.server.Login(context.Background(), origin, password)
	if err != nil {
		a.applyConnectionError(err)
		return a.snapshot(), err
	}
	if err := a.setToken(origin, token); err != nil {
		a.setServerState(status.AuthenticationRequired, "Keychain error")
		return a.snapshot(), err
	}
	a.setServerState(status.Connected, "Connected")
	go a.refreshServerVersion()
	go a.refreshDesktopRelease()
	return a.snapshot(), nil
}

// CheckServer revalidates the stored session without asking for the password.
func (a *App) CheckServer() (ManagerState, error) {
	state := a.snapshot()
	if state.ServerURL == "" {
		return state, errors.New("Configure the Pop Agent server first.")
	}
	a.setServerState(status.Connecting, "Connecting")
	if err := a.probeStoredSession(context.Background(), state.ServerURL); err != nil {
		return a.snapshot(), err
	}
	return a.snapshot(), nil
}

func (a *App) restoreSession(ctx context.Context) {
	origin := a.snapshot().ServerURL
	if err := a.probeStoredSession(ctx, origin); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintln(os.Stderr, "pop-desktop-tray: restore session:", publicError(err))
	}
}

func (a *App) probeStoredSession(ctx context.Context, origin string) error {
	token, err := a.getToken(origin)
	if errors.Is(err, keychain.ErrNotFound) {
		a.setServerState(status.AuthenticationRequired, "Authentication required")
		return errors.New("Authentication required.")
	}
	if err != nil {
		a.setServerState(status.AuthenticationRequired, "Keychain error")
		return err
	}
	renewed, err := a.server.ProbeSession(ctx, origin, token)
	if err != nil {
		if serverclient.IsKind(err, serverclient.InvalidSession) {
			_ = a.deleteToken(origin)
		}
		a.applyConnectionError(err)
		return err
	}
	if renewed != "" {
		if err := a.setToken(origin, renewed); err != nil {
			a.setServerState(status.AuthenticationRequired, "Keychain error")
			return err
		}
	}
	a.setServerState(status.Connected, "Connected")
	go a.refreshServerVersion()
	go a.refreshDesktopRelease()
	return nil
}

func (a *App) getToken(origin string) (string, error) {
	a.keychainMu.Lock()
	defer a.keychainMu.Unlock()
	return a.keychain.Get(origin)
}

func (a *App) setToken(origin, token string) error {
	a.keychainMu.Lock()
	defer a.keychainMu.Unlock()
	return a.keychain.Set(origin, token)
}

func (a *App) deleteToken(origin string) error {
	a.keychainMu.Lock()
	defer a.keychainMu.Unlock()
	return a.keychain.Delete(origin)
}

func (a *App) persistServerURL(origin string) error {
	a.mu.Lock()
	cfg := a.config
	path := a.configPath
	cfg.ServerURL = origin
	a.mu.Unlock()
	if path == "" {
		return errors.New("The Pop Desktop configuration path is unavailable.")
	}
	if err := config.Save(path, cfg); err != nil {
		return err
	}
	a.mu.Lock()
	a.config = cfg
	a.mu.Unlock()
	return nil
}

func (a *App) detectDesktop() {
	a.mu.Lock()
	path := a.desktopPath
	a.mu.Unlock()
	if path == "" {
		var err error
		path, err = desktop.DefaultInstallPath()
		if err != nil {
			a.setDesktopState(status.Offline, "Detection error", "Detection error", "Unavailable", "Unavailable")
			return
		}
	}
	installation := desktop.Detect(path)
	switch {
	case installation.Err != nil:
		a.setDesktopState(status.Offline, "Installation error", "Invalid installation", "Unavailable", path)
	case !installation.Installed:
		a.setDesktopState(status.NotInstalled, "Not installed", "Not installed", "Not installed", path)
	default:
		a.setDesktopState(status.Connected, "v"+installation.Version, "Installed", "v"+installation.Version, path)
	}
}

func (a *App) refreshDesktopRelease() {
	a.mu.Lock()
	origin := a.config.ServerURL
	connected := a.state.Server.State == status.Connected
	a.mu.Unlock()
	if origin == "" || !connected {
		return
	}
	token, err := a.getToken(origin)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	release, renewed, err := a.server.DesktopRelease(ctx, origin, token)
	if err != nil {
		return
	}
	if renewed != "" {
		_ = a.setToken(origin, renewed)
	}
	a.mu.Lock()
	if a.config.ServerURL != origin || a.state.Server.State != status.Connected {
		a.mu.Unlock()
		return
	}
	a.desktopRelease = release
	a.mu.Unlock()
	a.publish(a.snapshot())
	go a.prepareDesktopUpdate(release)
}

func (a *App) detectNode(ctx context.Context) {
	a.setNodeState(status.Checking, "Checking", "Checking", "Checking", "Searching common locations")
	result := nodedetect.Detect(ctx)
	if errors.Is(result.Err, context.Canceled) || errors.Is(result.Err, context.DeadlineExceeded) {
		return
	}
	switch {
	case result.Err != nil:
		fmt.Fprintln(os.Stderr, "pop-desktop-tray: detect Node:", result.Err)
		a.setNodeState(status.Offline, "Detection error", "Detection error", "Unavailable", "Unavailable")
	case result.Path == "":
		a.setNodeState(status.NotInstalled, "Not installed", "Not installed", "Not detected", "Not detected")
	case result.Compatible:
		a.setNodeState(status.Connected, result.Version, "Compatible", result.Version, result.Path)
	default:
		a.setNodeState(status.UpdateRequired, result.Version, "Update required (requires >= "+nodedetect.MinimumVersion+")", result.Version, result.Path)
	}
	a.detectCLI(ctx, result.Path)
}

func (a *App) detectCLI(ctx context.Context, nodePath string) {
	a.setCLIState(status.Checking, "Checking", "Checking", "Checking", "Searching common locations", "")
	result := clidetect.Detect(ctx, nodePath)
	if errors.Is(result.Err, context.Canceled) || errors.Is(result.Err, context.DeadlineExceeded) {
		return
	}
	switch {
	case result.Err != nil:
		fmt.Fprintln(os.Stderr, "pop-desktop-tray: detect Pop CLI:", result.Err)
		a.setCLIState(status.Offline, "Detection error", "Detection error", "Unavailable", "Unavailable", "")
	case result.CommandPath == "":
		a.setCLIState(status.NotInstalled, "Not installed", "Not installed", "Not detected", "Not detected", "")
	case nodePath == "":
		a.setCLIState(status.UpdateRequired, "v"+result.Version, "Installed; compatible Node required", "v"+result.Version, result.CommandPath, result.EntryPath)
	default:
		a.setCLIState(status.Connected, "v"+result.Version, "Installed", "v"+result.Version, result.CommandPath, result.EntryPath)
	}
	go a.refreshServerVersion()
}

func (a *App) refreshServerVersion() {
	a.mu.Lock()
	origin := a.config.ServerURL
	a.mu.Unlock()
	if origin == "" {
		return
	}
	token, err := a.getToken(origin)
	if err != nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	version, renewed, err := a.server.CurrentVersion(ctx, origin, token)
	if err != nil {
		return
	}
	if renewed != "" {
		_ = a.setToken(origin, renewed)
	}
	a.mu.Lock()
	a.serverVersion = version
	a.mu.Unlock()
	a.publish(a.snapshot())
}

func (a *App) setDesktopState(state status.State, text, detail, version, path string) {
	a.mu.Lock()
	a.state.Desktop.State = state
	a.state.Desktop.Text = text
	a.desktopDetail = detail
	a.desktopVersion = version
	a.desktopPath = path
	snapshot := ManagerState{ServerURL: a.config.ServerURL, ServerCheckedAt: a.serverCheckedAt, Status: a.state}
	a.mu.Unlock()
	a.publish(snapshot)
}

func (a *App) setCLIState(state status.State, text, detail, version, path, entryPath string) {
	a.mu.Lock()
	a.state.CLI.State = state
	a.state.CLI.Text = text
	a.cliDetail = detail
	a.cliVersion = version
	a.cliPath = path
	a.cliEntryPath = entryPath
	snapshot := ManagerState{ServerURL: a.config.ServerURL, ServerCheckedAt: a.serverCheckedAt, Status: a.state}
	a.mu.Unlock()
	a.publish(snapshot)
}

func (a *App) setNodeState(state status.State, text, detail, version, path string) {
	a.mu.Lock()
	a.state.Node.State = state
	a.state.Node.Text = text
	a.nodeDetail = detail
	a.nodeVersion = version
	a.nodePath = path
	snapshot := ManagerState{ServerURL: a.config.ServerURL, ServerCheckedAt: a.serverCheckedAt, Status: a.state}
	a.mu.Unlock()
	a.publish(snapshot)
}

func (a *App) applyConnectionError(err error) {
	switch {
	case serverclient.IsKind(err, serverclient.Offline):
		a.setServerState(status.Offline, "Offline")
	case serverclient.IsKind(err, serverclient.InvalidCredentials), serverclient.IsKind(err, serverclient.InvalidSession):
		a.setServerState(status.AuthenticationRequired, "Authentication required")
	default:
		a.setServerState(status.Offline, "Connection error")
	}
}

func (a *App) setServerState(state status.State, text string) {
	checkedAt := time.Time{}
	if state == status.Connected {
		text = "Connected"
		checkedAt = time.Now()
	}
	a.mu.Lock()
	if !checkedAt.IsZero() {
		a.serverCheckedAt = checkedAt
	}
	a.state.Server.State = state
	a.state.Server.Text = text
	snapshot := ManagerState{ServerURL: a.config.ServerURL, ServerCheckedAt: a.serverCheckedAt, Status: a.state}
	a.mu.Unlock()
	a.publish(snapshot)
}

func (a *App) snapshot() ManagerState {
	a.mu.Lock()
	defer a.mu.Unlock()
	return ManagerState{ServerURL: a.config.ServerURL, ServerCheckedAt: a.serverCheckedAt, Status: a.state}
}

func (a *App) publish(state ManagerState) {
	a.mu.Lock()
	startAtLogin := a.config.StartAtLogin
	nodeDetail := a.nodeDetail
	nodeVersion := a.nodeVersion
	nodePath := a.nodePath
	cliDetail := a.cliDetail
	cliVersion := a.cliVersion
	cliPath := a.cliPath
	serverVersion := a.serverVersion
	desktopDetail := a.desktopDetail
	desktopVersion := a.desktopVersion
	desktopPath := a.desktopPath
	desktopRelease := a.desktopRelease
	a.mu.Unlock()
	serverDetail := state.Status.Server.Text
	if state.Status.Server.State == status.Connected && !state.ServerCheckedAt.IsZero() {
		serverDetail = connectedStatusText(state.ServerCheckedAt)
	}
	cliActionTitle := "Update CLI…"
	installedVersion := strings.TrimPrefix(cliVersion, "v")
	if state.Status.CLI.State == status.NotInstalled {
		cliActionTitle = "Install CLI…"
	} else if serverVersion != "" && installedVersion == serverVersion {
		cliActionTitle = "Up to date"
	}
	cliActionEnabled := state.Status.CLI.State != status.Checking && nodePath != "" && serverVersion != "" && installedVersion != serverVersion
	desktopActionTitle := "Install Pop Desktop…"
	installedDesktopVersion := strings.TrimPrefix(desktopVersion, "v")
	if state.Status.Desktop.State == status.Connected {
		desktopActionTitle = "Update Pop Desktop…"
	}
	if desktopRelease.Version != "" && installedDesktopVersion == desktopRelease.Version {
		desktopActionTitle = "Up to date"
	}
	desktopActionEnabled := state.Status.Desktop.State != status.Checking && desktopRelease.Version != "" && installedDesktopVersion != desktopRelease.Version
	tray.Update(tray.MenuState{
		Server:                 "Server  ·  " + state.Status.Server.Text,
		ServerDetail:           serverDetail,
		ServerURL:              state.ServerURL,
		ServerIndicator:        indicatorFor(state.Status.Server.State),
		Desktop:                "Desktop  ·  " + state.Status.Desktop.Text,
		DesktopDetail:          desktopDetail,
		DesktopVersion:         desktopVersion,
		DesktopPath:            desktopPath,
		DesktopIndicator:       indicatorFor(state.Status.Desktop.State),
		CheckDesktopEnabled:    state.Status.Desktop.State != status.Checking,
		OpenDesktopEnabled:     state.Status.Desktop.State == status.Connected,
		InstallDesktopEnabled:  desktopActionEnabled,
		DesktopActionTitle:     desktopActionTitle,
		CLI:                    "CLI  ·  " + state.Status.CLI.Text,
		CLIDetail:              cliDetail,
		CLIVersion:             cliVersion,
		CLIPath:                cliPath,
		CLINodePath:            nodePath,
		CLIIndicator:           indicatorFor(state.Status.CLI.State),
		CheckCLIEnabled:        state.Status.CLI.State != status.Checking,
		UpdateCLIEnabled:       cliActionEnabled,
		CLIActionTitle:         cliActionTitle,
		Node:                   "Node  ·  " + state.Status.Node.Text,
		NodeDetail:             nodeDetail,
		NodeVersion:            nodeVersion,
		NodePath:               nodePath,
		NodeIndicator:          indicatorFor(state.Status.Node.State),
		CheckNodeEnabled:       state.Status.Node.State != status.Checking,
		StartAtLogin:           startAtLogin,
		StartAtLoginEnabled:    true,
		CheckUpdatesEnabled:    state.ServerURL != "" && state.Status.Server.State == status.Connected,
		CheckServerEnabled:     state.ServerURL != "" && state.Status.Server.State != status.Connecting,
		ConfigureServerEnabled: state.Status.Server.State != status.Connecting,
	})
}

func compareDesktopVersions(left, right string) int {
	leftParts := strings.Split(left, ".")
	rightParts := strings.Split(right, ".")
	for index := 0; index < 3; index++ {
		var leftValue, rightValue int
		if index < len(leftParts) {
			_, _ = fmt.Sscanf(leftParts[index], "%d", &leftValue)
		}
		if index < len(rightParts) {
			_, _ = fmt.Sscanf(rightParts[index], "%d", &rightValue)
		}
		if leftValue < rightValue {
			return -1
		}
		if leftValue > rightValue {
			return 1
		}
	}
	return 0
}

func npmCLIPath(nodePath string) (string, error) {
	candidate := filepath.Join(filepath.Dir(nodePath), "npm")
	resolved, err := filepath.EvalSymlinks(candidate)
	if err == nil {
		if info, statErr := os.Stat(resolved); statErr == nil && !info.IsDir() {
			return resolved, nil
		}
	}
	candidate = filepath.Clean(filepath.Join(filepath.Dir(nodePath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"))
	if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
		return candidate, nil
	}
	return "", errors.New("The selected Node installation does not include npm-cli.js.")
}

func envWithPath(prefix string, environment []string) []string {
	result := make([]string, 0, len(environment)+1)
	pathSet := false
	for _, variable := range environment {
		if strings.HasPrefix(variable, "PATH=") {
			result = append(result, "PATH="+prefix+string(os.PathListSeparator)+strings.TrimPrefix(variable, "PATH="))
			pathSet = true
			continue
		}
		result = append(result, variable)
	}
	if !pathSet {
		result = append(result, "PATH="+prefix)
	}
	return result
}

func connectedStatusText(checkedAt time.Time) string {
	return "Connected  ·  " + checkedAt.Format("02/01/2006 15:04:05")
}

func indicatorFor(state status.State) tray.Indicator {
	switch state {
	case status.Connected:
		return tray.IndicatorGood
	case status.Checking, status.Connecting, status.AuthenticationRequired, status.UpdateRequired:
		return tray.IndicatorWarning
	case status.Offline:
		return tray.IndicatorBad
	default:
		return tray.IndicatorNeutral
	}
}

func publicError(err error) string {
	var clientErr *serverclient.Error
	if errors.As(err, &clientErr) {
		return string(clientErr.Kind)
	}
	if errors.Is(err, keychain.ErrNotFound) {
		return "authentication required"
	}
	return "local error"
}

func userFacingError(err error) string {
	switch {
	case serverclient.IsKind(err, serverclient.Offline):
		return "Pop Agent server couldn't be reached. Check the server URL and try again."
	case serverclient.IsKind(err, serverclient.InvalidCredentials), serverclient.IsKind(err, serverclient.InvalidSession):
		return "Authentication failed. Check the password and try again."
	default:
		return err.Error()
	}
}
