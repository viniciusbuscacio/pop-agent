//go:build windows

package loginitem

import (
	"fmt"
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

const (
	runKeyPath     = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValue       = "Pop Desktop"
	legacyRunValue = "Pop Desktop Manager"
)

func enabled() (bool, error) {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKeyPath, registry.QUERY_VALUE)
	if err != nil {
		if err == registry.ErrNotExist {
			return false, nil
		}
		return false, fmt.Errorf("open startup registry key: %w", err)
	}
	defer key.Close()
	for _, name := range []string{runValue, legacyRunValue} {
		value, _, err := key.GetStringValue(name)
		if err == registry.ErrNotExist {
			continue
		}
		if err != nil {
			return false, fmt.Errorf("read startup registry value: %w", err)
		}
		if value != "" {
			return true, nil
		}
	}
	return false, nil
}

func setEnabled(value bool) error {
	key, _, err := registry.CreateKey(registry.CURRENT_USER, runKeyPath, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("open startup registry key: %w", err)
	}
	defer key.Close()
	if !value {
		for _, name := range []string{runValue, legacyRunValue} {
			if err := key.DeleteValue(name); err != nil && err != registry.ErrNotExist {
				return fmt.Errorf("remove startup registry value: %w", err)
			}
		}
		return nil
	}
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("locate Pop Desktop: %w", err)
	}
	if resolved, resolveErr := filepath.EvalSymlinks(executable); resolveErr == nil {
		executable = resolved
	}
	_ = key.DeleteValue(legacyRunValue)
	if err := key.SetStringValue(runValue, `"`+executable+`"`); err != nil {
		return fmt.Errorf("write startup registry value: %w", err)
	}
	return nil
}
