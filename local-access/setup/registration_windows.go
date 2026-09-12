//go:build windows

package main

import (
	"errors"
	"golang.org/x/sys/windows/registry"
)

const uninstallKey = `Software\Microsoft\Windows\CurrentVersion\Uninstall\` + setupID

// Exactly the values written by the pinned go-installer. Unrelated values are left untouched.
var registrationStrings = []string{"DisplayName", "DisplayVersion", "Publisher", "URLInfoAbout", "InstallLocation", "DisplayIcon", "UninstallString", "InstallDate"}
var registrationNumbers = []string{"NoModify", "NoRepair", "EstimatedSize"}

type registrationSnapshot struct {
	path    string
	exists  bool
	strings map[string]string
	numbers map[string]uint32
}

func snapshotRegistration(path string) (registrationSnapshot, error) {
	s := registrationSnapshot{path: path, strings: map[string]string{}, numbers: map[string]uint32{}}
	k, err := registry.OpenKey(registry.CURRENT_USER, path, registry.QUERY_VALUE)
	if err == registry.ErrNotExist {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	defer k.Close()
	s.exists = true
	for _, name := range registrationStrings {
		value, _, err := k.GetStringValue(name)
		if err == registry.ErrNotExist {
			continue
		}
		if err != nil {
			return s, err
		}
		s.strings[name] = value
	}
	for _, name := range registrationNumbers {
		value, _, err := k.GetIntegerValue(name)
		if err == registry.ErrNotExist {
			continue
		}
		if err != nil {
			return s, err
		}
		s.numbers[name] = uint32(value)
	}
	return s, nil
}

func (s registrationSnapshot) restore() error {
	if !s.exists {
		err := registry.DeleteKey(registry.CURRENT_USER, s.path)
		if err == registry.ErrNotExist {
			return nil
		}
		return err
	}
	k, _, err := registry.CreateKey(registry.CURRENT_USER, s.path, registry.SET_VALUE)
	if err != nil {
		return err
	}
	defer k.Close()
	var failures []error
	remove := func(name string) error {
		err := k.DeleteValue(name)
		if err == registry.ErrNotExist {
			return nil
		}
		return err
	}
	for _, name := range registrationStrings {
		if value, ok := s.strings[name]; ok {
			err = k.SetStringValue(name, value)
		} else {
			err = remove(name)
		}
		if err != nil {
			failures = append(failures, err)
		}
	}
	for _, name := range registrationNumbers {
		if value, ok := s.numbers[name]; ok {
			err = k.SetDWordValue(name, value)
		} else {
			err = remove(name)
		}
		if err != nil {
			failures = append(failures, err)
		}
	}
	return errors.Join(failures...)
}
