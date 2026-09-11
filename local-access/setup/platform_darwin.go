//go:build darwin

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const launchLabel = "com.popagent.local-access"

func installPaths() (string, string, string, error) {
	h, e := os.UserHomeDir()
	r := filepath.Join(h, "Library", "Application Support", "Pop Agent")
	c := os.Getenv("XDG_CONFIG_HOME")
	if c == "" {
		c = filepath.Join(h, ".config")
	}
	return r, filepath.Join(r, "runtime", "pop"), filepath.Join(c, "pop-agent", "profiles.json"), e
}
func desktopBundle() string {
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "Applications", "Pop Agent Desktop.app")
}
func desktopExecutable() string {
	return filepath.Join(desktopBundle(), "Contents", "MacOS", "Pop Agent Desktop")
}
func trayExecutable() string {
	return filepath.Join(desktopBundle(), "Contents", "Helpers", "Pop Local Access.app", "Contents", "MacOS", "Pop Local Access")
}
func legacyBundle() string {
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "Applications", "Pop Local Access.app")
}
func legacyTray() string {
	return filepath.Join(legacyBundle(), "Contents", "MacOS", "Pop Local Access")
}
func launchPlist() string {
	h, _ := os.UserHomeDir()
	return filepath.Join(h, "Library", "LaunchAgents", launchLabel+".plist")
}
func regularFile(p string) bool { i, e := os.Lstat(p); return e == nil && i.Mode().IsRegular() }
func checkInstallDirectory(p string) error {
	expected, _, profile, e := installPaths()
	if e != nil {
		return e
	}
	if p != expected {
		return errors.New("Unexpected installation directory")
	}
	for _, target := range []string{p, desktopBundle(), filepath.Dir(profile), launchPlist()} {
		for x := target; filepath.Dir(x) != x; x = filepath.Dir(x) {
			i, e := os.Lstat(x)
			if os.IsNotExist(e) {
				continue
			}
			if e != nil {
				return e
			}
			if i.Mode()&os.ModeSymlink != 0 {
				return errors.New("Installation paths must not contain symbolic links")
			}
		}
	}
	return nil
}
func startupEnabled() bool                        { return regularFile(launchPlist()) }
func savePrivateProfile(p string, b []byte) error { return atomicFile(p, b, 0600) }
func runBootstrap(ctx context.Context, exe, config string, args ...string) error {
	c := exec.CommandContext(ctx, exe, args...)
	for _, k := range []string{"HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "LANG"} {
		if v := os.Getenv(k); v != "" {
			c.Env = append(c.Env, k+"="+v)
		}
	}
	c.Env = append(c.Env, "XDG_CONFIG_HOME="+config)
	if e := c.Run(); e != nil {
		return errors.New("Could not prepare the verified Pop runtime. Check Tailscale, server availability and disk space, then retry")
	}
	return nil
}
func launcherVersion(ctx context.Context, p string) (string, error) {
	b, e := exec.CommandContext(ctx, p, "--launcher-version").Output()
	return strings.TrimSpace(string(b)), e
}
func versionGreater(a, b string) bool {
	x, y := strings.Split(a, "."), strings.Split(b, ".")
	if len(x) != 3 || len(y) != 3 {
		return false
	}
	for i := range x {
		u, e := strconv.Atoi(x[i])
		v, f := strconv.Atoi(y[i])
		if e != nil || f != nil {
			return false
		}
		if u != v {
			return u > v
		}
	}
	return false
}
func stopExact(ctx context.Context, p string) error {
	pattern := "^" + regexp.QuoteMeta(p) + "$"
	_ = exec.CommandContext(ctx, "pkill", "-TERM", "-f", pattern).Run()
	for i := 0; i < 40; i++ {
		if exec.CommandContext(ctx, "pgrep", "-f", pattern).Run() != nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return errors.New("Could not stop the installed Pop process. Close it and retry")
}
func xmlText(s string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", "\"", "&quot;").Replace(s)
}
func startupBytes(target string) []byte {
	return []byte(fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>%s</string><key>ProgramArguments</key><array><string>%s</string></array><key>RunAtLoad</key><true/></dict></plist>`, launchLabel, xmlText(target)))
}
func setStartup(enabled bool) error {
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	_ = exec.Command("launchctl", "bootout", domain+"/"+launchLabel).Run()
	if !enabled {
		e := os.Remove(launchPlist())
		if os.IsNotExist(e) {
			return nil
		}
		return e
	}
	if e := atomicFile(launchPlist(), startupBytes(trayExecutable()), 0600); e != nil {
		return e
	}
	return exec.Command("launchctl", "bootstrap", domain, launchPlist()).Run()
}
func launchDesktop() error { return exec.Command("open", desktopBundle()).Run() }
func launchTray() error {
	c := exec.Command(trayExecutable())
	if e := c.Start(); e != nil {
		return e
	}
	return c.Process.Release()
}

const pathStart = "# >>> Pop Agent CLI >>>"
const pathEnd = "# <<< Pop Agent CLI <<<"

func shellPathBlock(s, bin string, enable bool) (string, error) {
	a, b := strings.Index(s, pathStart), strings.Index(s, pathEnd)
	if (a < 0) != (b < 0) || (a >= 0 && b < a) {
		return "", errors.New("The Pop CLI shell configuration block is incomplete")
	}
	if a >= 0 {
		b += len(pathEnd)
		if b < len(s) && s[b] == '\n' {
			b++
		}
		s = s[:a] + s[b:]
	}
	if !enable {
		return s, nil
	}
	if s != "" && !strings.HasSuffix(s, "\n") {
		s += "\n"
	}
	q := "'" + strings.ReplaceAll(bin, "'", "'\\''") + "'"
	return s + pathStart + "\nexport PATH=" + q + ":\"$PATH\"\n" + pathEnd + "\n", nil
}
func shellFiles() []string {
	h, _ := os.UserHomeDir()
	z := os.Getenv("ZDOTDIR")
	if z == "" {
		z = h
	}
	return []string{filepath.Join(z, ".zprofile"), filepath.Join(h, ".bash_profile")}
}
