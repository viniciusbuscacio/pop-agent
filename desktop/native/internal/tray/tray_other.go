//go:build !darwin

package tray

import "errors"

func Install(Callbacks) error { return errors.New("system tray is supported only on macOS") }
func Update(MenuState)        {}
func Run()                    {}
func Stop()                   {}
func Remove()                 {}
