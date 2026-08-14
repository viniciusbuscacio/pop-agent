//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"runtime"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/config"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/desktopaccess"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/desktopwindow"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/peerprocess"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/singleinstance"
)

func main() {
	runtime.LockOSThread()
	lock, err := singleinstance.AcquireDesktop()
	if err != nil {
		if singleinstance.IsAlreadyRunning(err) {
			return
		}
		fmt.Fprintln(os.Stderr, "pop-desktop: single instance:", err)
		return
	}
	defer lock.Release()
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
	if cfg.ServerURL == "" {
		desktopwindow.ShowFatal("Configure the Pop Agent server in Pop Desktop first.")
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	access := desktopaccess.New(ctx, cfg.ServerURL)
	defer access.Close()
	if err := desktopwindow.Install(cfg.ServerURL, access.SetSession); err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop: window*", err)
		desktopwindow.ShowFatal("Pop Desktop could not create its native window.")
		return
	}
	defer desktopwindow.Remove()
	closeStop, err := peerprocess.WatchStop("desktop", desktopwindow.Stop)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop: stop signal:", err)
		desktopwindow.ShowFatal("Pop Desktop could not create its lifecycle signal.")
		return
	}
	defer closeStop()
	defer func() { _ = peerprocess.SignalStop("tray") }()
	if err := peerprocess.EnsureSibling("Pop Desktop Tray.exe", desktopwindow.Stop); err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop: tray:", err)
		desktopwindow.ShowFatal("Pop Desktop could not start its tray component.")
		return
	}
	desktopwindow.Run()
}
