//go:build darwin

package main

import (
	"bytes"
	_ "embed"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

//go:embed app.icns
var appIcon []byte

// Repair existing installations as well as fresh bundles without changing user settings.
func installAppIcon() error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	contents := filepath.Dir(filepath.Dir(executable))
	bundle := filepath.Dir(contents)
	if filepath.Base(contents) != "Contents" || filepath.Base(bundle) != "Pop Local Access.app" {
		return nil
	}
	plist := filepath.Join(contents, "Info.plist")
	const buddy = "/usr/libexec/PlistBuddy"
	identifier, err := exec.Command(buddy, "-c", "Print :CFBundleIdentifier", plist).Output()
	if err != nil || strings.TrimSpace(string(identifier)) != "com.popagent.local-access" {
		return err
	}
	resources := filepath.Join(contents, "Resources")
	if err = os.MkdirAll(resources, 0755); err != nil {
		return err
	}
	path := filepath.Join(resources, "app.icns")
	existing, _ := os.ReadFile(path)
	changed := !bytes.Equal(existing, appIcon)
	if changed {
		stage, e := os.CreateTemp(resources, ".app-icon-")
		if e != nil {
			return e
		}
		defer os.Remove(stage.Name())
		_, writeErr := stage.Write(appIcon)
		closeErr := stage.Close()
		if writeErr != nil {
			return writeErr
		}
		if closeErr != nil {
			return closeErr
		}
		if err = os.Chmod(stage.Name(), 0644); err != nil {
			return err
		}
		if err = os.Rename(stage.Name(), path); err != nil {
			return err
		}
	}
	icon, iconErr := exec.Command(buddy, "-c", "Print :CFBundleIconFile", plist).Output()
	if iconErr != nil || strings.TrimSpace(string(icon)) != "app.icns" {
		command := "Set :CFBundleIconFile app.icns"
		if iconErr != nil {
			command = "Add :CFBundleIconFile string app.icns"
		}
		if err = exec.Command(buddy, "-c", command, plist).Run(); err != nil {
			return err
		}
		changed = true
	}
	if changed {
		return exec.Command("/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister", "-f", bundle).Run()
	}
	return nil
}
