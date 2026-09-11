//go:build !windows

package main

func runDesktopIfRequested() bool     { return false }
func openDesktop(server string) error { return openExternal(server) }

func closeDesktopWindow() {}
