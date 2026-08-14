//go:build !darwin && !linux

package singleinstance

import "errors"

func acquire() (*Lock, error) {
	return nil, errors.New("single-instance lock is unsupported on this platform")
}
