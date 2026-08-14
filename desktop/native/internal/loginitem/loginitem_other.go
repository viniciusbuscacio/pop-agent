//go:build !darwin && !windows

package loginitem

import "errors"

func enabled() (bool, error) { return false, nil }
func setEnabled(bool) error  { return errors.New("Login Items are supported only on macOS") }
