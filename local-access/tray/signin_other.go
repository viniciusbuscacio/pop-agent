//go:build !darwin

package main

const nativeSignInAvailable = false

func promptPassword(string) (string, bool) { return "", false }
func showSignInError(string)               {}
