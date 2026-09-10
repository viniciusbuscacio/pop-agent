package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func isSetupName(name string) bool {
	name = strings.ToLower(filepath.Base(name))
	return name == "pop local access setup" || (strings.HasPrefix(name, "pop-local-access-") && strings.HasSuffix(name, "-setup.exe"))
}
func runSetupIfRequested() bool {
	source, err := os.Executable()
	if err != nil || !isSetupName(source) {
		return false
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	if !setupDialog("Pop Local Access Update", "This updates Pop Local Access to "+trayVersion+". Your sign-in, access permission and startup setting will be preserved.", "Continue", true) {
		return true
	}
	source, err = setupPayload(source)
	if err != nil {
		setupDialog("Cannot update", "The installer payload is unavailable or damaged.", "Close", false)
		return true
	}
	target, err := setupTarget()
	if err == nil {
		info, e := os.Lstat(target)
		if e != nil || !info.Mode().IsRegular() {
			err = errors.New("No installed Pop Local Access was found. Connect this computer from Settings → Devices first.")
		}
	}
	if err != nil {
		setupDialog("Cannot update", err.Error(), "Close", false)
		return true
	}
	if !setupDialog("Ready to install", "Finish any local operations before continuing. Pop Local Access will restart during the update.", "Install", true) {
		return true
	}
	if err = stopForSetup(target); err == nil {
		err = replaceInstalledTray(source, target, restartAfterSetup)
	}
	if err != nil {
		setupDialog("Update did not complete", err.Error(), "Close", false)
		return true
	}
	setupDialog("Pop Local Access updated", "Version "+trayVersion+" is installed. You can close this installer.", "Finish", false)
	return true
}

// Keep the previous bytes until the replacement can be started; never touch profiles or machine identity.
func replaceInstalledTray(source, target string, restart func(string) error) error {
	info, err := os.Lstat(target)
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("The installed application is unavailable")
	}
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	stage, err := os.CreateTemp(filepath.Dir(target), ".pla-update-")
	if err != nil {
		return err
	}
	name := stage.Name()
	defer os.Remove(name)
	_, err = io.Copy(stage, input)
	closeErr := stage.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	if err = os.Chmod(name, info.Mode().Perm()); err != nil {
		return err
	}
	backup := target + ".previous"
	if err = os.Remove(backup); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err = os.Rename(target, backup); err != nil {
		return err
	}
	if err = os.Rename(name, target); err != nil {
		_ = os.Rename(backup, target)
		return err
	}
	if err = restart(target); err != nil {
		_ = os.Remove(target)
		_ = os.Rename(backup, target)
		_ = restart(target)
		return errors.New("Could not restart the new application; the previous version was restored")
	}
	return nil
}
