package main

import (
	"context"
	"fmt"
	"os"
	"runtime"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/applifecycle"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/singleinstance"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/tray"
)

func main() {
	// Cocoa requires NSApplication and its event loop to live on the process's
	// original main thread.
	runtime.LockOSThread()

	link, err := applifecycle.OpenTray()
	if err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop-tray: lifecycle:", err)
		return
	}
	defer link.Close()

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
	app.showDesktop = link.ShowDesktop
	if err := app.startup(ctx, cancel); err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop-tray: startup:", err)
		os.Exit(1)
	}
	defer app.shutdown()
	link.WatchDesktop(app.quit)

	tray.Run()
}
