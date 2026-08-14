//go:build !windows

package winprocess

import "os/exec"

func HideWindow(command *exec.Cmd) *exec.Cmd { return command }
