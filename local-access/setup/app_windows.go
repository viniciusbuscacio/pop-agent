//go:build windows

package main

import (
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	installer "github.com/viniciusbuscacio/go-installer/windows"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed assets/license.txt
var licenseText string

//go:embed payload/*
var payload embed.FS

const setupID = "pop-local-access-setup"

type State struct {
	Components       Components `json:"components"`
	Version          string     `json:"version"`
	InstalledVersion string     `json:"installedVersion"`
	Installed        bool       `json:"installed"`
	Directory        string     `json:"directory"`
	Server           string     `json:"server"`
	SavedLogin       bool       `json:"savedLogin"`
	StartAtLogin     bool       `json:"startAtLogin"`
	Busy             bool       `json:"busy"`
	Done             bool       `json:"done"`
	Stage            string     `json:"stage"`
	Error            string     `json:"error"`
	License          string     `json:"license"`
	Preview          bool       `json:"preview"`
	Uninstall        bool       `json:"uninstall"`
}

type Setup struct {
	mu           sync.Mutex
	ctx          context.Context
	state        State
	installDir   string
	launcherPath string
	profilePath  string
	initialized  bool
	allowClose   bool
}

func newSetup(preview bool) *Setup {
	a := &Setup{state: State{Version: version, License: licenseText, Preview: preview, Uninstall: installer.UninstallRequested(), StartAtLogin: true, Components: Components{Desktop: true, CLI: true}}}
	if preview {
		a.state.Directory = `C:\Users\You\AppData\Local\PopAgent\LocalAccess`
		a.state.Stage = "Preview only - no files or settings will be changed."
		return a
	}
	dir, launcher, profile, err := installPaths()
	if err != nil {
		a.state.Error = "Could not resolve your Windows user folders."
		return a
	}
	a.installDir, a.launcherPath, a.profilePath = dir, launcher, profile
	a.state.Directory = dir
	existingDesktop := regularFile(filepath.Join(dir, "pop-local-access.exe"))
	a.state.Installed = existingDesktop || regularFile(filepath.Join(dir, "cli", "pop.exe"))
	if _, ver, ok := a.product().InstalledInfo(); ok {
		a.state.InstalledVersion = ver
	}
	if existingDesktop {
		a.state.StartAtLogin = startupEnabled()
	}
	if a.state.Uninstall {
		a.initialized = true
		return a
	}
	old, err := readProfile(profile)
	if err != nil {
		a.state.Error = err.Error()
		return a
	}
	if origin, err := serverOrigin(old.server); err == nil {
		a.state.Server = origin
		a.state.SavedLogin = old.token != ""
	}
	if a.state.Server == "" {
		if executable, err := os.Executable(); err == nil {
			if data, err := os.ReadFile(executable + ":Zone.Identifier"); err == nil {
				a.state.Server = originFromDownload(data)
			}
		}
	}
	a.initialized = true
	return a
}
func (a *Setup) product() installer.App {
	return installer.App{ID: setupID, DisplayName: "Pop Agent", Version: version, Publisher: "Vinicius Buscacio", URL: projectURL, Dir: a.installDir}
}
func (a *Setup) startup(ctx context.Context) { a.ctx = ctx }
func (a *Setup) GetState() State             { a.mu.Lock(); defer a.mu.Unlock(); return a.state }
func (a *Setup) beforeClose(context.Context) bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.state.Busy && !a.allowClose
}
func (a *Setup) completedQuit() {
	a.mu.Lock()
	a.allowClose = true
	a.mu.Unlock()
	wruntime.Quit(a.ctx)
}
func (a *Setup) Close() {
	if !a.GetState().Busy {
		wruntime.Quit(a.ctx)
	}
}
func (a *Setup) OpenProject()      { wruntime.BrowserOpenURL(a.ctx, projectURL) }
func (a *Setup) Minimize()         { wruntime.WindowMinimise(a.ctx) }
func (a *Setup) stage(text string) { a.mu.Lock(); a.state.Stage = text; a.mu.Unlock() }

// Password is accepted only through the in-process Wails binding. It is never returned, logged or passed to a process.
func (a *Setup) Install(server, password string, desktop, cli bool) string {
	selected := Components{Desktop: desktop, CLI: cli}
	if err := selected.validate(); err != nil {
		return err.Error()
	}
	a.mu.Lock()
	if a.state.Preview {
		a.mu.Unlock()
		return "Preview only. Installation is disabled."
	}
	if a.state.Busy || a.state.Done || !a.initialized {
		a.mu.Unlock()
		return "The installer is not ready."
	}
	a.state.Busy = true
	a.state.Components = selected
	a.state.Error = ""
	a.mu.Unlock()
	var failure error
	defer func() {
		a.mu.Lock()
		a.state.Busy = false
		if failure != nil {
			a.state.Error = failure.Error()
		} else {
			a.state.Done = true
			a.state.Stage = "Installation complete."
		}
		a.mu.Unlock()
	}()
	ctx, cancel := context.WithTimeout(a.ctx, 10*time.Minute)
	defer cancel()
	failure = a.performInstall(ctx, server, password)
	password = ""
	if failure != nil {
		return failure.Error()
	}
	return ""
}

func (a *Setup) performInstall(ctx context.Context, server, password string) error {
	selected := a.GetState().Components
	manifestPath := filepath.Join(a.installDir, "components.json")
	installed := Components{Desktop: regularFile(filepath.Join(a.installDir, "pop-local-access.exe"))}
	if data, err := readBoundedFile(manifestPath, 4096); err == nil {
		if json.Unmarshal(data, &installed) != nil {
			return errors.New("The installed component record is invalid.")
		}
	} else if !os.IsNotExist(err) {
		return errors.New("Could not read the installed component record.")
	}
	selected = selected.including(installed)
	desktopPath := filepath.Join(a.installDir, "pop-agent-desktop.exe")
	cliPath := filepath.Join(a.installDir, "cli", "pop.exe")
	if versionGreater(a.state.InstalledVersion, version) {
		return errors.New("A newer Pop Agent is already installed. Download the current installer from your server.")
	}
	origin, err := serverOrigin(server)
	if err != nil {
		return err
	}
	a.stage("Verifying the installer and saved connection…")
	source, _ := fs.Sub(payload, "payload")
	files, err := verifiedPayload(source)
	if err != nil {
		return err
	}
	if err = checkInstallDirectory(a.installDir); err != nil {
		return err
	}
	before, err := readProfile(a.profilePath)
	if err != nil {
		return err
	}
	token := before.token
	previousOrigin, _ := serverOrigin(before.server)
	if password != "" || previousOrigin != origin || token == "" {
		a.stage("Signing in securely…")
		token, err = login(ctx, origin, password)
		password = ""
		if err != nil {
			return err
		}
	} else if !savedSessionValid(ctx, origin, token) {
		return errors.New("Your saved sign-in has expired. Enter your password to reconnect.")
	}
	if err = os.MkdirAll(a.installDir, 0700); err != nil {
		return errors.New("Could not create the installation folder.")
	}
	staging, err := os.MkdirTemp(a.installDir, ".prepare-")
	if err != nil {
		return err
	}
	cleanStaging := true
	defer func() {
		if cleanStaging {
			_ = os.RemoveAll(staging)
		}
	}()
	// The bootstrap profile contains only a confirmed origin, never an access token.
	config := filepath.Join(staging, "config")
	stub, _ := updatedProfiles(profileSnapshot{}, origin, "")
	if err = atomicFile(filepath.Join(config, "pop-agent", "profiles.json"), stub, 0600); err != nil {
		return err
	}
	bootstrap := filepath.Join(staging, "pop.exe")
	if err = atomicFile(bootstrap, files["launcher"], 0700); err != nil {
		return err
	}
	embeddedLauncherVersion, err := launcherVersion(ctx, bootstrap)
	if err != nil {
		return errors.New("Could not verify the embedded Pop launcher.")
	}
	a.stage("Preparing the verified Node runtime…")
	if err = runBootstrap(ctx, bootstrap, config, "runtime", "install", "--server", origin); err != nil {
		return err
	}
	a.stage("Preparing the Pop command-line runtime…")
	if err = runBootstrap(ctx, bootstrap, config, "update"); err != nil {
		return err
	}
	if !unchangedProfile(a.profilePath, before) {
		return errors.New("Your saved login changed during installation. Retry without closing other Pop clients.")
	}
	// Keep original bytes until installation succeeds. Never replace a newer shared launcher.
	tray := filepath.Join(a.installDir, "pop-local-access.exe")
	targets := []string{tray, a.launcherPath, filepath.Join(a.installDir, setupID+".exe"), desktopPath, cliPath, manifestPath}
	snapshots, err := snapshotFiles(targets)
	if err != nil {
		return err
	}
	if err = backupFiles(snapshots, filepath.Join(staging, "backup")); err != nil {
		return errors.New("Could not preserve the previous program files. Nothing was replaced.")
	}
	registration, err := snapshotRegistration(uninstallKey)
	if err != nil {
		return errors.New("Could not preserve the existing Windows registration. Nothing was replaced.")
	}
	pathBefore, err := readUserPath()
	if err != nil {
		return errors.New("Could not read your terminal PATH. Nothing was replaced.")
	}
	pathAfter := componentPath(pathBefore, filepath.Join(a.installDir, "cli"), true)
	pathChanged := false
	launcherBytes := files["launcher"]
	if snapshots[1].exists {
		if output, e := launcherVersion(ctx, a.launcherPath); e != nil {
			return errors.New("Could not verify the installed Pop launcher.")
		} else if versionGreater(output, embeddedLauncherVersion) {
			launcherBytes = snapshots[1].data
		}
	}
	a.stage("Installing the selected Pop Agent components…")
	if selected.Desktop {
		if err = stopDesktop(ctx, desktopPath); err != nil {
			return err
		}
		if err = stopTray(ctx, tray); err != nil {
			return err
		}
	}
	restartOld := installed.Desktop
	rollback := func(message string) error {
		recovery := errors.Join(restoreFiles(snapshots), registration.restore())
		if pathChanged {
			current, err := readUserPath()
			if err == nil && current == pathAfter {
				err = writeUserPath(pathBefore)
			} else if err == nil {
				err = errors.New("Your terminal PATH changed during recovery.")
			}
			recovery = errors.Join(recovery, err)
		}
		if restartOld && recovery == nil {
			recovery = launchTray(tray)
		}
		if recovery != nil {
			cleanStaging = false
			return errors.New(message + " Automatic recovery could not finish. Previous program files were retained in " + filepath.Join(staging, "backup") + ".")
		}
		return errors.New(message + " Previous program files and registration were restored.")
	}
	if err = atomicFile(a.launcherPath, launcherBytes, 0700); err != nil {
		return rollback("Could not install the Pop launcher.")
	}
	if selected.Desktop {
		if err = atomicFile(tray, files["tray"], 0700); err != nil {
			return rollback("Could not install computer access.")
		}
		if err = atomicFile(desktopPath, files["tray"], 0700); err != nil {
			return rollback("Could not install Pop Agent Desktop.")
		}
	}
	if selected.CLI {
		cliBytes := launcherBytes
		if snapshots[4].exists {
			previous, e := launcherVersion(ctx, cliPath)
			if e != nil {
				return rollback("Could not verify Pop Agent CLI.")
			}
			if versionGreater(previous, embeddedLauncherVersion) {
				cliBytes = snapshots[4].data
			}
		}
		if err = atomicFile(cliPath, cliBytes, 0700); err != nil {
			return rollback("Could not install Pop Agent CLI.")
		}
	}
	componentBytes, _ := json.Marshal(selected)
	if err = atomicFile(manifestPath, componentBytes, 0600); err != nil {
		return rollback("Could not save the component selection.")
	}
	if _, err = a.product().Install(); err != nil {
		return rollback("Windows could not register the installer.")
	}
	if !unchangedProfile(a.profilePath, before) {
		return rollback("Your saved login changed during installation.")
	}
	updated, err := updatedProfiles(before, origin, token)
	if err != nil {
		return rollback("Could not preserve the saved profiles.")
	}
	if selected.CLI {
		current, err := readUserPath()
		if err != nil || current != pathBefore {
			return rollback("Your terminal PATH changed during installation. Please retry.")
		}
		if err := writeUserPath(pathAfter); err != nil {
			return rollback("Could not add Pop Agent CLI to your terminal PATH.")
		}
		pathChanged = true
	}
	if err = savePrivateProfile(a.profilePath, updated); err != nil {
		return rollback("Could not protect and save the login.")
	}
	a.mu.Lock()
	a.state.Components = selected
	a.state.Server = origin
	a.state.SavedLogin = true
	a.mu.Unlock()
	return nil
}

func (a *Setup) Finish(startMenu, desktop, startAtLogin, open bool) string {
	a.mu.Lock()
	if a.state.Preview || a.state.Busy || !a.state.Done {
		a.mu.Unlock()
		return "Installation has not completed."
	}
	a.state.Busy = true
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.state.Busy = false; a.mu.Unlock() }()
	components := a.GetState().Components
	tray := filepath.Join(a.installDir, "pop-local-access.exe")
	if components.CLI {
		cliProduct := a.product()
		cliProduct.DisplayName = "Pop Agent CLI"
		if err := cliProduct.CreateShortcuts(filepath.Join(a.installDir, "cli", "pop.exe"), installer.Shortcuts{StartMenu: startMenu}); err != nil {
			return "Could not create the CLI shortcut. Please retry."
		}
	}
	if components.Desktop {
		if err := removeComponentShortcuts("Pop Local Access"); err != nil {
			return "Could not replace the previous Local Access shortcuts. Please retry."
		}
		desktopProduct := a.product()
		desktopProduct.DisplayName = "Pop Agent Desktop"
		if err := desktopProduct.CreateShortcuts(filepath.Join(a.installDir, "pop-agent-desktop.exe"), installer.Shortcuts{StartMenu: startMenu, Desktop: desktop}); err != nil {
			return "Could not create the Desktop shortcuts. Please retry."
		}
		if err := setStartup(tray, startAtLogin); err != nil {
			return "Could not save Start at Login. Please retry."
		}
		if open {
			if err := launchTray(filepath.Join(a.installDir, "pop-agent-desktop.exe")); err != nil {
				return "Pop Agent Desktop is installed, but could not open. Please retry."
			}
		}
	}
	a.completedQuit()
	return ""
}

func (a *Setup) Uninstall(confirm bool) string {
	a.mu.Lock()
	if a.state.Preview || a.state.Busy || !a.initialized || !confirm {
		a.mu.Unlock()
		return "Uninstall was not confirmed."
	}
	a.state.Busy = true
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.state.Busy = false; a.mu.Unlock() }()
	if err := checkInstallDirectory(a.installDir); err != nil {
		return err.Error()
	}
	if loc, _, ok := a.product().InstalledInfo(); !ok || !strings.EqualFold(filepath.Clean(loc), filepath.Clean(a.installDir)) {
		return "The registered installation location could not be verified."
	}
	ctx, cancel := context.WithTimeout(a.ctx, 30*time.Second)
	defer cancel()
	if err := stopTray(ctx, filepath.Join(a.installDir, "pop-local-access.exe")); err != nil {
		return err.Error()
	}
	if err := stopDesktop(ctx, filepath.Join(a.installDir, "pop-agent-desktop.exe")); err != nil {
		return err.Error()
	}
	oldPath, err := readUserPath()
	if err != nil {
		return "Could not read your terminal PATH."
	}
	if err := writeUserPath(componentPath(oldPath, filepath.Join(a.installDir, "cli"), false)); err != nil {
		return "Could not remove Pop Agent CLI from your terminal PATH."
	}
	old := startupValue()
	if err := setStartup("", false); err != nil {
		_ = writeUserPath(oldPath)
		return "Could not remove Start at Login."
	}
	for _, name := range []string{"Pop Agent Desktop", "Pop Agent CLI", "Pop Local Access"} {
		if err := removeComponentShortcuts(name); err != nil {
			restoreStartup(old)
			_ = writeUserPath(oldPath)
			return "Could not remove component shortcuts. Please retry."
		}
	}
	if err := a.product().Uninstall(); err != nil {
		restoreStartup(old)
		_ = writeUserPath(oldPath)
		return fmt.Sprintf("Could not start the uninstaller: %s", err)
	}
	a.completedQuit()
	return ""
}
