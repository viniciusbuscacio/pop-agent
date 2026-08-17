//go:build darwin || windows

package main

import (
	_ "embed"
	"errors"
	"fmt"

	"github.com/getlantern/systray"
)

type viewState struct {
	Server       string
	Status       string
	Paused       bool
	StartAtLogin bool
}

type trayView struct {
	status, server, open, pause, reconnect, diagnostics, startAtLogin, quit *systray.MenuItem
}

var activeView trayView

func installTray(a *app) error {
	if a == nil {
		return errors.New("tray app is required")
	}
	a.view = trayView{}
	currentApp = a
	return nil
}

func runTray() {
	systray.Run(func() {
		systray.SetTemplateIcon(trayIcon, trayIcon)
		systray.SetTooltip(fmt.Sprintf("Pop Local Access %s", trayVersion))
		activeView.status = systray.AddMenuItem("Starting", "Connection status — click to reconnect")
		activeView.server = systray.AddMenuItem("—", "Pop Agent server — click to open")
		systray.AddSeparator()
		activeView.open = systray.AddMenuItem("Open Pop Agent", "Open the PWA in your default browser")
		activeView.pause = systray.AddMenuItem("Pause Local Access", "Stop local tools without uninstalling")
		activeView.reconnect = systray.AddMenuItem("Reconnect", "Restart the secure outbound connection")
		systray.AddSeparator()
		activeView.startAtLogin = systray.AddMenuItemCheckbox("Start at Login", "Start Pop Local Access when you sign in", false)
		activeView.diagnostics = systray.AddMenuItem("Diagnostics…", "Open the local log")
		systray.AddSeparator()
		activeView.quit = systray.AddMenuItem("Quit Pop Local Access", "Stop local access until opened again")
		bind(activeView.status, func(a *app) { a.reconnect() })
		bind(activeView.server, func(a *app) { a.openPop() })
		bind(activeView.open, func(a *app) { a.openPop() })
		bind(activeView.pause, func(a *app) { a.togglePause() })
		bind(activeView.reconnect, func(a *app) { a.reconnect() })
		bind(activeView.startAtLogin, func(a *app) { a.toggleStartAtLogin() })
		bind(activeView.diagnostics, func(a *app) { a.diagnostics() })
		bind(activeView.quit, func(a *app) { a.quit() })
		currentApp.view = activeView
		currentApp.publish()
	}, func() {})
}

var currentApp *app

func bind(item *systray.MenuItem, action func(*app)) {
	go func() {
		for range item.ClickedCh {
			if currentApp != nil {
				action(currentApp)
			}
		}
	}()
}

func (v trayView) Update(state viewState) {
	if v.status == nil {
		return
	}
	v.status.SetStatusTitle(state.Status, state.Status == "Connected")
	if state.Server == "" {
		v.server.SetTitle("Server not configured")
		v.open.Disable()
	} else {
		v.server.SetTitle(state.Server)
		v.open.Enable()
	}
	if state.Paused {
		v.pause.SetTitle("Resume Local Access")
		v.reconnect.Disable()
	} else {
		v.pause.SetTitle("Pause Local Access")
		v.reconnect.Enable()
	}
	if state.StartAtLogin {
		v.startAtLogin.Check()
	} else {
		v.startAtLogin.Uncheck()
	}
}

func stopTray() { systray.Quit() }
