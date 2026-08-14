//go:build darwin || linux

package singleinstance

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func acquire() (*Lock, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return nil, fmt.Errorf("locate Application Support: %w", err)
	}
	directory := filepath.Join(root, "Pop Agent")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create application data directory: %w", err)
	}
	// Keep the historical lock name during migration so an old Manager and the
	// unified Desktop can never supervise PLA at the same time.
	return acquirePath(filepath.Join(directory, "manager.lock"))
}

func acquirePath(path string) (*Lock, error) {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, fmt.Errorf("open instance lock: %w", err)
	}
	if err := syscall.Flock(int(file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		_ = file.Close()
		if errors.Is(err, syscall.EWOULDBLOCK) {
			return nil, ErrAlreadyRunning
		}
		return nil, fmt.Errorf("acquire instance lock: %w", err)
	}
	return &Lock{release: func() error {
		unlockErr := syscall.Flock(int(file.Fd()), syscall.LOCK_UN)
		closeErr := file.Close()
		return errors.Join(unlockErr, closeErr)
	}}, nil
}
