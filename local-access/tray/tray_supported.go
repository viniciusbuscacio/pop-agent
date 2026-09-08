//go:build darwin || windows

package main

import (
	_ "embed"
	"errors"
	"fmt"

	"github.com/getlantern/systray"
)

type viewState struct {
	Server        string
	Status        string
	AccessEnabled bool
	AccessKnown   bool
	StartAtLogin  bool
	SigningIn     bool
}

type trayView struct {
	status, server, open, access, reconnect, diagnostics, startAtLogin, quit, signIn *systray.MenuItem
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
		if nativeSignInAvailable {
			activeView.signIn = systray.AddMenuItem("Sign in…", "Sign in to reconnect this computer without opening Terminal")
			bind(activeView.signIn, func(a *app) { a.signIn() })
		}
		activeView.access = systray.AddMenuItemCheckbox("Allow access to local files", "Allow Pop Agent to access files on this computer", false)
		activeView.reconnect = systray.AddMenuItem("Reconnect", "Restart the secure outbound connection")
		systray.AddSeparator()
		activeView.startAtLogin = systray.AddMenuItemCheckbox("Start at Login", "Start Pop Local Access when you sign in", false)
		activeView.diagnostics = systray.AddMenuItem("Diagnostics…", "Open the local log")
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
	v.status.SetStatusTitle(state.Status, state.AccessEnabled && state.AccessKnown)
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
			v.signIn.SetTitle("Sign in…")
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
