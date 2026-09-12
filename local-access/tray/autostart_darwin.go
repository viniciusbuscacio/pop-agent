//go:build darwin

package main

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const launchLabel = "com.popagent.local-access"

func launchAgentPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Library", "LaunchAgents", launchLabel+".plist"), nil
}

func startAtLoginEnabled() (bool, error) {
	path, err := launchAgentPath()
	if err != nil {
		return false, err
	}
	_, err = os.Stat(path)
	if os.IsNotExist(err) {
		return false, nil
	}
	return err == nil, err
}

func setStartAtLogin(enabled bool) error {
	path, err := launchAgentPath()
	if err != nil {
		return err
	}
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	if !enabled {
		_ = exec.Command("launchctl", "bootout", domain+"/"+launchLabel).Run()
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	var escaped bytes.Buffer
	if err := xml.EscapeText(&escaped, []byte(executable)); err != nil {
		return err
	}
	contents := fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>%s</string>
<key>ProgramArguments</key><array><string>%s</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>
`, launchLabel, escaped.String())
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		return err
	}
	_ = exec.Command("launchctl", "bootout", domain+"/"+launchLabel).Run()
	return exec.Command("launchctl", "bootstrap", domain, path).Run()
}
