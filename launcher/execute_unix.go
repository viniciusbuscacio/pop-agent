//go:build !windows

package main

import (
	"os"
	"syscall"
)

func executeCLI(node, entry string, args []string) (int, error) {
	argv := append([]string{node, entry}, args...)
	if err := syscall.Exec(node, argv, os.Environ()); err != nil {
		return 1, err
	}
	return 0, nil
}
