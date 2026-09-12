//go:build !darwin && !windows

package main

import "errors"

func startAtLoginEnabled() (bool, error) { return false, nil }
func setStartAtLogin(bool) error {
	return errors.New("start at login is not available on this platform")
}
