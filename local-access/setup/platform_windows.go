//go:build windows

package main

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

const runKey = `Software\Microsoft\Windows\CurrentVersion\Run`
const runName = "Pop Local Access"

func installPaths() (string, string, string, error) {
	local, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
	if err != nil {
		return "", "", "", err
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", "", "", err
	}
	config := os.Getenv("XDG_CONFIG_HOME")
	if config == "" {
		config = filepath.Join(home, ".config")
	}
	return filepath.Join(local, "PopAgent", "LocalAccess"), filepath.Join(local, "PopAgent", "LocalAccess", "runtime", "pop.exe"), filepath.Join(config, "pop-agent", "profiles.json"), nil
}
func regularFile(path string) bool {
	info, err := os.Lstat(path)
	return err == nil && info.Mode().IsRegular()
}
func checkInstallDirectory(path string) error {
	expected, launcher, profile, err := installPaths()
	if err != nil {
		return err
	}
	if !strings.EqualFold(filepath.Clean(path), filepath.Clean(expected)) {
		return errors.New("The installation must use its dedicated Pop Agent directory.")
	}
	for _, target := range []string{path, filepath.Dir(launcher), filepath.Join(path, "cli"), filepath.Dir(profile)} {
		for current := target; filepath.Dir(current) != current; current = filepath.Dir(current) {
			ptr, e := windows.UTF16PtrFromString(current)
			if e != nil {
				return e
			}
			attrs, e := windows.GetFileAttributes(ptr)
			if e == windows.ERROR_FILE_NOT_FOUND || e == windows.ERROR_PATH_NOT_FOUND {
				continue
			}
			if e != nil {
				return errors.New("Could not verify the installation directory.")
			}
			if attrs&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0 {
				return errors.New("Installer directories must not contain symbolic links or junctions.")
			}
		}
	}
	return nil
}
func privateACL(path string, directory bool) error {
	user, err := windows.GetCurrentProcessToken().GetTokenUser()
	if err != nil {
		return err
	}
	inheritance := ""
	if directory {
		inheritance = "OICI"
	}
	descriptor, err := windows.SecurityDescriptorFromString("D:P(A;" + inheritance + ";FA;;;" + user.User.Sid.String() + ")")
	if err != nil {
		return err
	}
	acl, _, err := descriptor.DACL()
	if err != nil {
		return err
	}
	return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION|windows.PROTECTED_DACL_SECURITY_INFORMATION, nil, nil, acl, nil)
}
func savePrivateProfile(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}
	if err := privateACL(dir, true); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".login-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = privateACL(f.Name(), false); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
func hiddenCommand(ctx context.Context, exe string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, exe, args...)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	return cmd
}
func runBootstrap(ctx context.Context, exe, config string, args ...string) error {
	cmd := hiddenCommand(ctx, exe, args...)
	env := []string{}
	allowed := map[string]bool{"SYSTEMROOT": true, "WINDIR": true, "USERPROFILE": true, "HOME": true, "LOCALAPPDATA": true, "APPDATA": true, "TEMP": true, "TMP": true, "PATH": true, "PATHEXT": true, "COMSPEC": true, "PROGRAMFILES": true, "PROGRAMFILES(X86)": true, "PROGRAMDATA": true, "ALLUSERSPROFILE": true, "HOMEDRIVE": true, "HOMEPATH": true}
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if allowed[strings.ToUpper(key)] {
			env = append(env, entry)
		}
	}
	cmd.Env = append(env, "XDG_CONFIG_HOME="+config)
	// Deliberately discard output: errors may contain URLs/paths, never show raw subprocess transcripts.
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return errors.New("Preparation timed out. Check the network and retry; the existing PLA was not replaced.")
		}
		return errors.New("Could not prepare the verified Pop runtime. Check Tailscale, server availability and available disk space, then retry.")
	}
	return nil
}
func launcherVersion(ctx context.Context, exe string) (string, error) {
	out, err := hiddenCommand(ctx, exe, "--launcher-version").Output()
	return strings.TrimSpace(string(out)), err
}
func versionGreater(left, right string) bool {
	a := strings.Split(left, ".")
	b := strings.Split(right, ".")
	if len(a) != 3 || len(b) != 3 {
		return false
	}
	for i := 0; i < 3; i++ {
		x, e := strconv.Atoi(a[i])
		y, f := strconv.Atoi(b[i])
		if e != nil || f != nil {
			return false
		}
		if x != y {
			return x > y
		}
	}
	return false
}
func stopTray(ctx context.Context, target string) error {
	ps := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	cmd := hiddenCommand(ctx, ps, "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter "Name = 'pop-local-access.exe'" | Where-Object { $_.ExecutablePath -eq $env:POP_PLA_TARGET } | ForEach-Object { & "$env:SystemRoot\System32\taskkill.exe" /PID $_.ProcessId /T /F | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Could not stop Local Access' }; Wait-Process -Id $_.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }`)
	cmd.Env = append(os.Environ(), "POP_PLA_TARGET="+target)
	if err := cmd.Run(); err != nil {
		return errors.New("Could not stop the existing Local Access process. Close it from the tray and retry.")
	}
	return nil
}
func stopDesktop(ctx context.Context, target string) error {
	ps := filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
	cmd := hiddenCommand(ctx, ps, "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter "Name = 'pop-agent-desktop.exe'" | Where-Object { $_.ExecutablePath -eq $env:POP_PLA_TARGET } | ForEach-Object { & "$env:SystemRoot\System32\taskkill.exe" /PID $_.ProcessId /T /F | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Could not stop Pop Agent Desktop' }; Wait-Process -Id $_.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }`)
	cmd.Env = append(os.Environ(), "POP_PLA_TARGET="+target)
	if err := cmd.Run(); err != nil {
		return errors.New("Could not stop the existing Pop Agent Desktop process. Close it from the tray and retry.")
	}
	return nil
}
func launchTray(target string) error {
	cmd := exec.Command(target)
	cmd.Dir = filepath.Dir(target)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: windows.CREATE_NO_WINDOW}
	return cmd.Start()
}
func startupValue() string {
	k, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return ""
	}
	defer k.Close()
	v, _, _ := k.GetStringValue(runName)
	return v
}
func startupEnabled() bool { return startupValue() != "" }
func setStartup(target string, enabled bool) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !enabled {
		err = k.DeleteValue(runName)
		if err == registry.ErrNotExist {
			return nil
		}
		return err
	}
	return k.SetStringValue(runName, `"`+target+`"`)
}
func restoreStartup(value string) {
	if value == "" {
		_ = setStartup("", false)
		return
	}
	k, _, err := registry.CreateKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err == nil {
		defer k.Close()
		_ = k.SetStringValue(runName, value)
	}
}

// Validate the library's cleanup handoff before it can remove anything. It may only remove this product's dedicated directory.
func validCleanup() bool {
	for _, arg := range os.Args[1:] {
		manifest, ok := strings.CutPrefix(arg, "--go-installer-cleanup=")
		if !ok {
			continue
		}
		expected, _, _, err := installPaths()
		if err != nil {
			return false
		}
		return validateCleanupManifest(manifest, expected)
	}
	return false
}

func removeComponentShortcuts(name string) error {
	if name != "Pop Agent Desktop" && name != "Pop Agent CLI" && name != "Pop Local Access" {
		return errors.New("Unknown component shortcut.")
	}
	for _, id := range []*windows.KNOWNFOLDERID{windows.FOLDERID_Programs, windows.FOLDERID_Desktop} {
		root, err := windows.KnownFolderPath(id, 0)
		if err != nil {
			return err
		}
		target := filepath.Join(root, name+".lnk")
		if !strings.EqualFold(filepath.Dir(target), filepath.Clean(root)) {
			return errors.New("Invalid shortcut path.")
		}
		if err := os.Remove(target); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}
