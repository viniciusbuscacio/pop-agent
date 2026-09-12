//go:build windows

package main

import (
	"golang.org/x/sys/windows"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"unsafe"
)

func setupDialog(title, message, button string, cancel bool) bool {
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(message)
	flags := uintptr(0x40)
	if cancel {
		flags |= 1
	}
	result, _, _ := windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), flags)
	return result == 1
}
func setupTarget() (string, error) {
	root := os.Getenv("LOCALAPPDATA")
	if root == "" {
		return "", os.ErrNotExist
	}
	return filepath.Join(root, "PopAgent", "LocalAccess", "pop-local-access.exe"), nil
}
func stopForSetup(target string) error {
	command := exec.Command(filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoProfile", "-NonInteractive", "-Command", `$ErrorActionPreference='Stop'; Get-CimInstance Win32_Process -Filter "Name = 'pop-local-access.exe'" | Where-Object { $_.ExecutablePath -eq $env:POP_PLA_TARGET } | ForEach-Object { & "$env:SystemRoot\System32\taskkill.exe" /PID $_.ProcessId /T /F | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Could not stop Pop Local Access' }; Wait-Process -Id $_.ProcessId -Timeout 10 -ErrorAction SilentlyContinue }`)
	command.Env = append(os.Environ(), "POP_PLA_TARGET="+target)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command.Run()
}
func restartAfterSetup(target string) error {
	command := exec.Command(target)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command.Start()
}

func setupPayload(executable string) (string, error) { return executable, nil }
