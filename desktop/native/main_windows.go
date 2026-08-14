//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"runtime"
	"sync"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/peerprocess"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/singleinstance"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/tray"
)

func main() {
	runtime.LockOSThread()
	lock, err := singleinstance.Acquire()
	if err != nil {
		if singleinstance.IsAlreadyRunning(err) {
			return
		}
		fmt.Fprintln(os.Stderr, "pop-desktop-tray: single instance:", err)
		os.Exit(1)
	}
	defer lock.Release()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	app := NewApp()
	app.onQuit = func() { _ = peerprocess.SignalStop("desktop") }
	var peerOnce sync.Once
	var peerErr error
	startDesktop := func() error {
		peerOnce.Do(func() {
			peerErr = peerprocess.EnsureSibling("Pop Desktop.exe", app.quit)
		})
		return peerErr
	}
	app.showDesktop = startDesktop
	if err := app.startup(ctx, cancel); err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop-tray: startup:", err)
		os.Exit(1)
	}
	defer app.shutdown()
	closeStop, err := peerprocess.WatchStop("tray", app.quit)
	if err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop-tray: stop signal:", err)
		return
	}
	defer closeStop()
	// A fresh install remains tray-only until the server is configured; after
	// configuration, starting either executable owns the same coupled lifecycle.
	if app.config.ServerURL != "" {
		if err := startDesktop(); err != nil {
			fmt.Fprintln(os.Stderr, "pop-desktop-tray: desktop:", err)
			return
		}
	}
	tray.Run()
}
