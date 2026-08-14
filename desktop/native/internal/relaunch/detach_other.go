//go:build !darwin && !linux

package relaunch

import "syscall"

func detachedProcessAttributes() *syscall.SysProcAttr { return nil }
