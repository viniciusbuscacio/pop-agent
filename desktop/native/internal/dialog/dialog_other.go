//go:build !darwin && !windows

package dialog

func promptServer(string) (string, string, bool) { return "", "", false }
func confirm(string, string, string) bool        { return false }
func showInfo(string, string)                    {}
func showError(string, string)                   {}
