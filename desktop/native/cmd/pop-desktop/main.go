//go:build !windows

package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/applifecycle"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/config"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/desktopaccess"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/desktopwindow"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/relaunch"
)

func main() {
	if handled, code := relaunch.RunIfRequested(os.Args[1:]); handled {
		os.Exit(code)
	}
	runtime.LockOSThread()
	path, err := config.DefaultPath()
	if err != nil {
		desktopwindow.ShowFatal("Pop Desktop could not locate its configuration.")
		return
	}
	cfg, err := config.LoadOrCreate(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop: configuration:", err)
		desktopwindow.ShowFatal("Pop Desktop could not read its configuration.")
		return
	}
	executable, err := os.Executable()
	if err != nil {
		desktopwindow.ShowFatal("Pop Desktop could not locate a required component.")
		return
	}
	helper := filepath.Join(filepath.Dir(filepath.Dir(executable)), "Helpers", "Pop Desktop Tray")
	link, err := applifecycle.StartTray(helper)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop: tray:", err)
		desktopwindow.ShowFatal("Pop Desktop could not start its menu-bar component.")
		return
	}
	defer link.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	access := desktopaccess.New(ctx, cfg.ServerURL)
	defer access.Close()
	if err := desktopwindow.Install(cfg.ServerURL, access.SetSession); err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop: window:", err)
		desktopwindow.ShowFatal("Pop Desktop could not create its native window.")
		return
	}
	defer desktopwindow.Remove()
	link.Watch(desktopwindow.Show, desktopwindow.Stop)
	desktopwindow.Run()
}
