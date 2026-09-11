//go:build darwin

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
)

func (a *Setup) performInstall(ctx context.Context, server, password string) error {
	selected := a.GetState().Components
	if versionGreater(a.state.InstalledVersion, version) {
		return errors.New("A newer Pop Agent is installed. Download the current installer")
	}
	if e := checkInstallDirectory(a.installDir); e != nil {
		return e
	}
	installed := Components{Desktop: regularFile(desktopExecutable()) || regularFile(legacyTray()), CLI: regularFile(filepath.Join(a.installDir, "cli", "pop"))}
	record := filepath.Join(a.installDir, "components.json")
	if b, e := readBoundedFile(record, 4096); e == nil {
		if json.Unmarshal(b, &installed) != nil {
			return errors.New("Invalid component record")
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	selected = selected.including(installed)
	origin, e := serverOrigin(server)
	if e != nil {
		return e
	}
	a.stage("Verifying the installer and saved connection…")
	source := a.source
	if source == nil {
		source, _ = fs.Sub(payload, "payload")
	}
	prepare := a.prepare
	if prepare == nil {
		prepare = runBootstrap
	}
	files, e := verifiedPayload(source)
	if e != nil {
		return e
	}
	if !payloadExecutable(files["tray"], "darwin") || !payloadExecutable(files["launcher"], "darwin") {
		return errors.New("This payload is not for macOS")
	}
	before, e := readProfile(a.profilePath)
	if e != nil {
		return e
	}
	token := before.token
	previousOrigin, _ := serverOrigin(before.server)
	if password != "" || previousOrigin != origin || token == "" {
		a.stage("Signing in securely…")
		token, e = login(ctx, origin, password)
		password = ""
		if e != nil {
			return e
		}
	} else if !savedSessionValid(ctx, origin, token) {
		return errors.New("Your saved sign-in expired. Enter your password to reconnect")
	}
	if e = os.MkdirAll(a.installDir, 0700); e != nil {
		return e
	}
	stage, e := os.MkdirTemp(a.installDir, ".prepare-")
	if e != nil {
		return e
	}
	clean := true
	defer func() {
		if clean {
			_ = os.RemoveAll(stage)
		}
	}()
	config := filepath.Join(stage, "config")
	stub, _ := updatedProfiles(profileSnapshot{}, origin, "")
	if e = atomicFile(filepath.Join(config, "pop-agent", "profiles.json"), stub, 0600); e != nil {
		return e
	}
	bootstrap := filepath.Join(stage, "pop")
	if e = atomicFile(bootstrap, files["launcher"], 0700); e != nil {
		return e
	}
	if e = exec.CommandContext(ctx, "codesign", "--verify", "--strict", bootstrap).Run(); e != nil {
		return errors.New("Invalid launcher signature")
	}
	a.stage("Preparing the verified Node runtime…")
	if e = prepare(ctx, bootstrap, config, "runtime", "install", "--server", origin); e != nil {
		return e
	}
	a.stage("Preparing the Pop command-line runtime…")
	if e = prepare(ctx, bootstrap, config, "update"); e != nil {
		return e
	}
	if !unchangedProfile(a.profilePath, before) {
		return errors.New("Your saved login changed during installation. Retry")
	}
	writes := map[string][]byte{a.launcherPath: files["launcher"]}
	if selected.CLI {
		writes[filepath.Join(a.installDir, "cli", "pop")] = files["launcher"]
	}
	if selected.Desktop {
		writes[desktopExecutable()] = files["tray"]
		writes[trayExecutable()] = files["tray"]
		icon, e := fs.ReadFile(source, "app.icns")
		if e != nil {
			return errors.New("Missing application icon")
		}
		writes[filepath.Join(desktopBundle(), "Contents", "Resources", "app.icns")] = icon
		writes[filepath.Join(desktopBundle(), "Contents", "Info.plist")] = desktopPlist(version)
		helper := filepath.Dir(filepath.Dir(trayExecutable()))
		writes[filepath.Join(helper, "Resources", "app.icns")] = icon
		writes[filepath.Join(helper, "Info.plist")] = []byte(`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.popagent.local-access</string><key>CFBundleName</key><string>Pop Local Access</string><key>CFBundleExecutable</key><string>Pop Local Access</string><key>CFBundleIconFile</key><string>app.icns</string><key>LSUIElement</key><true/></dict></plist>`)
	}
	data, _ := json.Marshal(selected)
	writes[record] = data
	writes[filepath.Join(a.installDir, "version")] = []byte(version)
	paths := []string{}
	if selected.Desktop {
		paths = append(paths, filepath.Join(desktopBundle(), "Contents", "_CodeSignature", "CodeResources"), filepath.Join(filepath.Dir(filepath.Dir(trayExecutable())), "_CodeSignature", "CodeResources"))
	}
	for p := range writes {
		paths = append(paths, p)
	}
	if selected.CLI {
		paths = append(paths, shellFiles()...)
	}
	snapshots, e := snapshotFiles(paths)
	if e != nil {
		return e
	}
	if e = backupFiles(snapshots, filepath.Join(stage, "backup")); e != nil {
		return e
	}
	for _, s := range snapshots {
		if (s.path == a.launcherPath || s.path == filepath.Join(a.installDir, "cli", "pop")) && s.exists {
			old, e := launcherVersion(ctx, s.path)
			if e != nil {
				return errors.New("Could not verify installed launcher")
			}
			incoming, e := launcherVersion(ctx, bootstrap)
			if e != nil {
				return e
			}
			if versionGreater(old, incoming) {
				writes[s.path] = s.data
			}
		}
	}
	startup, e := snapshotFiles([]string{launchPlist()})
	if e != nil {
		return e
	}
	rollback := func(cause error) error {
		recovery := errors.Join(restoreFiles(snapshots), restoreFiles(startup))
		if installed.Desktop {
			if regularFile(launchPlist()) {
				_ = exec.Command("launchctl", "bootstrap", fmt.Sprintf("gui/%d", os.Getuid()), launchPlist()).Run()
			} else {
				p := trayExecutable()
				if regularFile(legacyTray()) {
					p = legacyTray()
				}
				c := exec.Command(p)
				if err := c.Start(); err == nil {
					_ = c.Process.Release()
				} else {
					recovery = errors.Join(recovery, err)
				}
			}
		}
		if recovery != nil {
			clean = false
			return fmt.Errorf("%v. Recovery needs attention; previous files remain in %s", cause, filepath.Join(stage, "backup"))
		}
		return fmt.Errorf("%v. Previous files were restored", cause)
	}
	a.stage("Installing the selected Pop Agent components…")
	if selected.Desktop {
		stop := a.stopProcesses
		if stop == nil {
			stop = stopInstalledDesktop
		}
		if e = stop(ctx); e != nil {
			return rollback(e)
		}
	}

	for p, b := range writes {
		mode := fs.FileMode(0600)
		if p == desktopExecutable() || p == trayExecutable() || p == a.launcherPath || p == filepath.Join(a.installDir, "cli", "pop") {
			mode = 0700
		}
		if e = atomicFile(p, b, mode); e != nil {
			return rollback(e)
		}
	}
	if selected.Desktop {
		sign := a.signApp
		if sign == nil {
			sign = signInstalledDesktop
		}
		if e = sign(ctx); e != nil {
			return rollback(e)
		}
	}

	if selected.CLI {
		for _, p := range shellFiles() {
			b, e := os.ReadFile(p)
			if e != nil && !os.IsNotExist(e) {
				return rollback(e)
			}
			text, e := shellPathBlock(string(b), filepath.Join(a.installDir, "cli"), true)
			if e != nil {
				return rollback(e)
			}
			if e = atomicFile(p, []byte(text), 0600); e != nil {
				return rollback(e)
			}
		}
	}
	if !unchangedProfile(a.profilePath, before) {
		return rollback(errors.New("Your login changed during installation"))
	}
	updated, e := updatedProfiles(before, origin, token)
	if e != nil {
		return rollback(e)
	}
	if e = savePrivateProfile(a.profilePath, updated); e != nil {
		return rollback(e)
	}
	a.mu.Lock()
	a.state.Components = selected
	a.state.Server = origin
	a.state.SavedLogin = true
	a.mu.Unlock()
	return nil
}
func desktopPlist(v string) []byte {
	return []byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.popagent.desktop</string><key>CFBundleName</key><string>Pop Agent Desktop</string><key>CFBundleExecutable</key><string>Pop Agent Desktop</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleIconFile</key><string>app.icns</string><key>CFBundleShortVersionString</key><string>%s</string><key>CFBundleVersion</key><string>%s</string><key>NSMicrophoneUsageDescription</key><string>Record voice messages when you choose to use the microphone.</string><key>NSCameraUsageDescription</key><string>Use the camera when you choose to share it.</string></dict></plist>`, xmlText(v), xmlText(v)))
}
func (a *Setup) Finish(_, _, startAtLogin, open bool) string {
	a.mu.Lock()
	if a.state.Preview || a.state.Busy || !a.state.Done {
		a.mu.Unlock()
		return "Installation has not completed"
	}
	a.state.Busy = true
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.state.Busy = false; a.mu.Unlock() }()
	if a.GetState().Components.Desktop {
		if e := setStartup(startAtLogin); e != nil {
			return "Could not save Start at Login. Please retry"
		}
		if open {
			if e := launchDesktop(); e != nil {
				return "Could not open Pop Agent Desktop. Please retry"
			}
		} else if !startAtLogin {
			if e := launchTray(); e != nil {
				return "Could not start computer access. Please retry"
			}
		}
		if regularFile(legacyTray()) {
			target := filepath.Join(a.installDir, "previous-local-access")
			if _, e := os.Stat(target); os.IsNotExist(e) {
				if e = os.Rename(legacyBundle(), target); e != nil {
					return "Could not retire the old Local Access app. Close it and retry"
				}
			}
		}
		_ = exec.Command("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", "-f", desktopBundle()).Run()
	}
	a.completedQuit()
	return ""
}
func (a *Setup) Uninstall(confirm bool) string {
	a.mu.Lock()
	if a.state.Preview || a.state.Busy || !a.initialized || !confirm {
		a.mu.Unlock()
		return "Uninstall was not confirmed"
	}
	a.state.Busy = true
	a.mu.Unlock()
	defer func() { a.mu.Lock(); a.state.Busy = false; a.mu.Unlock() }()
	if e := checkInstallDirectory(a.installDir); e != nil {
		return e.Error()
	}
	if e := stopExact(a.ctx, desktopExecutable()); e != nil {
		return e.Error()
	}
	if e := setStartup(false); e != nil {
		return e.Error()
	}
	if e := stopExact(a.ctx, trayExecutable()); e != nil {
		return e.Error()
	}
	for _, p := range shellFiles() {
		b, e := os.ReadFile(p)
		if os.IsNotExist(e) {
			continue
		}
		if e != nil {
			return e.Error()
		}
		text, e := shellPathBlock(string(b), "", false)
		if e != nil {
			return e.Error()
		}
		if e = atomicFile(p, []byte(text), 0600); e != nil {
			return e.Error()
		}
	}
	for _, p := range []string{desktopBundle(), filepath.Join(a.installDir, "cli"), filepath.Join(a.installDir, "runtime"), filepath.Join(a.installDir, "components.json"), filepath.Join(a.installDir, "version")} {
		if e := os.RemoveAll(p); e != nil {
			return e.Error()
		}
	}
	a.completedQuit()
	return ""
}

func stopInstalledDesktop(ctx context.Context) error {
	if e := stopExact(ctx, desktopExecutable()); e != nil {
		return e
	}
	_ = exec.Command("launchctl", "bootout", fmt.Sprintf("gui/%d/%s", os.Getuid(), launchLabel)).Run()
	for _, path := range []string{filepath.Join(desktopBundle(), "Contents", "MacOS", "Pop Local Access"), legacyTray(), trayExecutable()} {
		if e := stopExact(ctx, path); e != nil {
			return e
		}
	}
	return nil
}
func signInstalledDesktop(ctx context.Context) error {
	if e := exec.CommandContext(ctx, "codesign", "--force", "--deep", "--sign", "-", desktopBundle()).Run(); e != nil {
		return errors.New("Could not sign installed app")
	}
	if e := exec.CommandContext(ctx, "codesign", "--verify", "--deep", "--strict", desktopBundle()).Run(); e != nil {
		return errors.New("Installed app verification failed")
	}
	return nil
}
