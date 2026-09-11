//go:build darwin

package main

import (
	"context"
	"embed"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed assets/license.txt
var licenseText string

//go:embed payload/*
var payload embed.FS

const setupID = "pop-local-access-setup"

type State struct {
	Platform         string     `json:"platform"`
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
	source        fs.FS
	prepare       func(context.Context, string, string, ...string) error
	stopProcesses func(context.Context) error
	signApp       func(context.Context) error
	mu            sync.Mutex
	ctx           context.Context
	state         State
	installDir    string
	launcherPath  string
	profilePath   string
	initialized   bool
	allowClose    bool
}

func newSetup(preview bool) *Setup {
	a := &Setup{state: State{Platform: "darwin", Version: version, License: licenseText, Preview: preview, StartAtLogin: true, Components: Components{Desktop: true, CLI: true}}}
	if preview {
		a.state.Directory = "~/Applications/Pop Agent Desktop.app"
		a.state.Stage = "Preview only - no files or settings will be changed."
		return a
	}
	dir, launcher, profile, err := installPaths()
	if err != nil {
		a.state.Error = "Could not resolve your macOS user folders."
		return a
	}
	a.installDir, a.launcherPath, a.profilePath = dir, launcher, profile
	a.state.Directory = dir
	existingDesktop := regularFile(desktopExecutable()) || regularFile(legacyTray())
	a.state.Installed = existingDesktop || regularFile(filepath.Join(dir, "cli", "pop"))
	if data, e := os.ReadFile(filepath.Join(dir, "version")); e == nil {
		a.state.InstalledVersion = string(data)
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
	a.initialized = true
	return a
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
