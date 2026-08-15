//go:build !darwin && !windows

package main

import "errors"

type viewState struct {
	Server       string
	Status       string
	Paused       bool
	StartAtLogin bool
}

type trayView struct{}

func installTray(*app) error      { return errors.New("tray is supported only on Windows and macOS") }
func runTray()                    {}
func stopTray()                   {}
func (trayView) Update(viewState) {}
