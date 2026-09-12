//go:build !darwin && !windows

package main

import "errors"

func setupDialog(string, string, string, bool) bool { return false }
func setupTarget() (string, error)                  { return "", errors.New("Unsupported platform") }
func stopForSetup(string) error                     { return errors.New("Unsupported platform") }
func restartAfterSetup(string) error                { return errors.New("Unsupported platform") }

func setupPayload(executable string) (string, error) { return executable, nil }
