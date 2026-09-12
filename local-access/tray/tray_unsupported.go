//go:build !darwin && !windows

package main

import "errors"

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

type trayView struct{}

func installTray(*app) error      { return errors.New("tray is supported only on Windows and macOS") }
func runTray()                    {}
func stopTray()                   {}
func (trayView) Update(viewState) {}
