//go:build windows

package main

import (
	"os"
	"os/exec"
)

func executeCLI(node, entry string, args []string) (int, error) {
	cmd := exec.Command(node, append([]string{entry}, args...)...)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		if exit, ok := err.(*exec.ExitError); ok {
			return exit.ExitCode(), nil
		}
		return 1, err
	}
	return 0, nil
}
