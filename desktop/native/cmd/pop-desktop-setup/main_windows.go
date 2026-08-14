//go:build windows

package main

import (
	"embed"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

//go:embed payload/*
var payload embed.FS

var messageBox = windows.NewLazySystemDLL("user32.dll").NewProc("MessageBoxW")

func main() {
	if err := install(); err != nil {
		show("Pop Desktop Setup", err.Error(), 0x10)
		os.Exit(1)
	}
	show("Pop Desktop Setup", "Pop Desktop was installed for this Windows user and is starting.", 0x40)
}

func install() error {
	root := os.Getenv("LOCALAPPDATA")
	if root == "" {
		return errors.New("LOCALAPPDATA is unavailable")
	}
	destination := filepath.Join(root, "Programs", "Pop Desktop")
	parent := filepath.Dir(destination)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return err
	}
	stop("Pop Desktop Manager.exe")
	stop("Pop Desktop.exe")
	stage, err := os.MkdirTemp(parent, ".pop-desktop-install-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	for _, name := range []string{"Pop Desktop Manager.exe", "Pop Desktop.exe", "Pop Desktop.exe.version", "Pop Desktop.ico"} {
		bytes, err := payload.ReadFile("payload/" + name)
		if err != nil {
			return fmt.Errorf("read %s: %w", name, err)
		}
		if err := os.WriteFile(filepath.Join(stage, name), bytes, 0o700); err != nil {
			return fmt.Errorf("write %s: %w", name, err)
		}
	}
	backup := destination + ".previous"
	_ = os.RemoveAll(backup)
	if _, err := os.Stat(destination); err == nil {
		if err := os.Rename(destination, backup); err != nil {
			return fmt.Errorf("prepare existing installation: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.Rename(stage, destination); err != nil {
		_ = os.Rename(backup, destination)
		return fmt.Errorf("activate installation: %w", err)
	}
	_ = os.RemoveAll(backup)
	for _, name := range []string{"Pop Desktop Manager.exe", "Pop Desktop.exe"} {
		command := exec.Command(filepath.Join(destination, name))
		command.SysProcAttr = &syscall.SysProcAttr{CreationFlags: windows.DETACHED_PROCESS | windows.CREATE_NEW_PROCESS_GROUP, HideWindow: true}
		if err := command.Start(); err != nil {
			return fmt.Errorf("start %s: %w", name, err)
		}
		if err := command.Process.Release(); err != nil {
			return err
		}
		if name == "Pop Desktop Manager.exe" {
			time.Sleep(750 * time.Millisecond)
		}
	}
	return nil
}

func stop(name string) {
	executable := filepath.Join(os.Getenv("SystemRoot"), "System32", "taskkill.exe")
	if os.Getenv("SystemRoot") == "" {
		executable = "taskkill.exe"
	}
	command := exec.Command(executable, "/IM", name, "/T")
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = command.Run()
	time.Sleep(500 * time.Millisecond)
	force := exec.Command(executable, "/IM", name, "/T", "/F")
	force.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	_ = force.Run()
	time.Sleep(250 * time.Millisecond)
}
func show(title, text string, icon uintptr) {
	t, _ := windows.UTF16PtrFromString(title)
	m, _ := windows.UTF16PtrFromString(text)
	messageBox.Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), icon|0x10000)
}
