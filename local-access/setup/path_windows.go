//go:build windows

package main

import (
	"errors"
	"path/filepath"
	"strings"
	"unsafe"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"
)

type pathSnapshot struct {
	value  string
	kind   uint32
	exists bool
}

func readUserPath() (pathSnapshot, error) {
	k, err := registry.OpenKey(registry.CURRENT_USER, `Environment`, registry.QUERY_VALUE)
	if err == registry.ErrNotExist {
		return pathSnapshot{}, nil
	}
	if err != nil {
		return pathSnapshot{}, err
	}
	defer k.Close()
	v, kind, err := k.GetStringValue("Path")
	if err == registry.ErrNotExist {
		return pathSnapshot{}, nil
	}
	if err != nil {
		return pathSnapshot{}, err
	}
	if kind != registry.SZ && kind != registry.EXPAND_SZ {
		return pathSnapshot{}, errors.New("The user PATH has an unsupported format.")
	}
	return pathSnapshot{v, kind, true}, nil
}

func writeUserPath(p pathSnapshot) error {
	k, _, err := registry.CreateKey(registry.CURRENT_USER, `Environment`, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	if !p.exists {
		err = k.DeleteValue("Path")
		if err == registry.ErrNotExist {
			err = nil
		}
	} else if p.kind == registry.EXPAND_SZ {
		err = k.SetExpandStringValue("Path", p.value)
	} else {
		err = k.SetStringValue("Path", p.value)
	}
	if err == nil {
		name, _ := windows.UTF16PtrFromString("Environment")
		var result uintptr
		windows.NewLazySystemDLL("user32.dll").NewProc("SendMessageTimeoutW").Call(0xffff, 0x001A, 0, uintptr(unsafe.Pointer(name)), 2, 2000, uintptr(unsafe.Pointer(&result)))
	}
	return err
}

func componentPath(before pathSnapshot, directory string, add bool) pathSnapshot {
	parts := strings.Split(before.value, ";")
	normalize := func(s string) string { return strings.ToLower(filepath.Clean(strings.Trim(strings.TrimSpace(s), `"`))) }
	matched := false
	kept := make([]string, 0, len(parts)+1)
	for _, part := range parts {
		if normalize(part) == normalize(directory) {
			matched = true
			if !add {
				continue
			}
		}
		kept = append(kept, part)
	}
	if add && !matched {
		if len(kept) == 1 && kept[0] == "" {
			kept = nil
		}
		kept = append(kept, directory)
	}
	before.value = strings.Join(kept, ";")
	if add && !before.exists {
		before.exists = true
		before.kind = registry.EXPAND_SZ
	}
	return before
}
