//go:build darwin || windows

package main

import (
	_ "embed"
	"errors"
	"fmt"

	"github.com/getlantern/systray"
)

type viewState struct {
	UpdateTitle     string
	UpdateBusy      bool
	UpdateAvailable bool
	Server          string
	Status          string
	Connected       bool
	AccessEnabled   bool
	AccessKnown     bool
	StartAtLogin    bool
	SigningIn       bool
}

type trayView struct {
	settings, update, status, server, open, access, reconnect, diagnostics, startAtLogin, quit, signIn *systray.MenuItem
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
		activeView.status = systray.AddMenuItem("Server disconnected", "Connection status — click to reconnect")
		systray.AddSeparator()
		activeView.open = systray.AddMenuItem("Open Pop Agent", "Open the PWA in your default browser")
		computer := systray.AddMenuItem("Computer access", "Manage access to this computer")
		activeView.access = computer.AddSubMenuItemCheckbox("Allow access to this computer", "Allow Pop Agent to use local tools on this computer", false)
		if nativeSignInAvailable {
			activeView.signIn = computer.AddSubMenuItem("Sign in again…", "Sign in to reconnect this computer without opening Terminal")
			bind(activeView.signIn, func(a *app) { a.signIn() })
		}
		activeView.settings = systray.AddMenuItem("Settings", "Startup, updates and troubleshooting")
		activeView.startAtLogin = activeView.settings.AddSubMenuItemCheckbox("Start at Login", "Start Pop Local Access when you sign in", false)
		activeView.update = activeView.settings.AddSubMenuItem("Check for updates…", "Download an update installer from your Pop Server")
		bind(activeView.update, func(a *app) { a.activateUpdate() })
		troubleshooting := activeView.settings.AddSubMenuItem("Troubleshooting", "Connection details and local logs")
		activeView.reconnect = troubleshooting.AddSubMenuItem("Reconnect", "Restart the secure outbound connection")
		activeView.diagnostics = troubleshooting.AddSubMenuItem("Open logs", "Open the local log")
		activeView.server = troubleshooting.AddSubMenuItem("Server not configured", "Pop Agent server — click to open")
		systray.AddSeparator()
		activeView.quit = systray.AddMenuItem("Quit Pop Local Access", "Stop local access until opened again")
		bind(activeView.status, func(a *app) { a.activateStatus() })
		bind(activeView.server, func(a *app) { a.openPop() })
		bind(activeView.open, func(a *app) { a.openPop() })
		bind(activeView.access, func(a *app) { a.toggleAccess() })
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
	if state.UpdateAvailable {
		v.settings.SetTitle("Settings · Update available")
	} else {
		v.settings.SetTitle("Settings")
	}
	if state.UpdateTitle != "" {
		v.update.SetTitle(state.UpdateTitle)
	}
	if state.UpdateBusy {
		v.update.Disable()
	} else {
		v.update.Enable()
	}
	title := "Server disconnected"
	if state.Connected {
		title = "Server connected"
	}
	v.status.SetStatusTitle(title, state.Connected)
	v.status.SetTooltip(state.Status + " — click to reconnect")
	if state.Server == "" {
		v.server.SetTitle("Server not configured")
		v.open.Disable()
	} else {
		v.server.SetTitle(state.Server)
		v.open.Enable()
	}
	if state.AccessEnabled {
		v.access.Check()
	} else {
		v.access.Uncheck()
	}
	if state.AccessKnown {
		v.access.Enable()
	} else {
		v.access.Disable()
	}
	v.reconnect.Enable()
	if v.signIn != nil {
		if state.SigningIn {
			v.signIn.SetTitle("Signing in…")
			v.signIn.Disable()
			v.reconnect.Disable()
			v.status.Disable()
		} else {
			v.signIn.SetTitle("Sign in again…")
			v.signIn.Enable()
			v.status.Enable()
		}
	}
	if state.StartAtLogin {
		v.startAtLogin.Check()
	} else {
		v.startAtLogin.Uncheck()
	}
}

func stopTray() { systray.Quit() }
