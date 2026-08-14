//go:build windows

package relaunch

import "errors"

func Start(string, int, int) error {
	return errors.New("Pop Desktop update activation is not published for Windows yet")
}
func RunIfRequested([]string) (bool, int) { return false, 0 }
