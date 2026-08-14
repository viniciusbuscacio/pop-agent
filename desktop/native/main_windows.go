//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"runtime"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/desktop"
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
	app.showDesktop = func() error {
		path, err := desktop.DefaultInstallPath()
		if err != nil {
			return err
		}
		return desktop.Open(path)
	}
	if err := app.startup(ctx, cancel); err != nil {
		fmt.Fprintln(os.Stderr, "pop-desktop-tray: startup:", err)
		os.Exit(1)
	}
	defer app.shutdown()
	tray.Run()
}
