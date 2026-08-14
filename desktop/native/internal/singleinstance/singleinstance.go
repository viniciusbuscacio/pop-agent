package singleinstance

import "errors"

var ErrAlreadyRunning = errors.New("Pop Desktop is already running")

func IsAlreadyRunning(err error) bool { return errors.Is(err, ErrAlreadyRunning) }

type Lock struct{ release func() error }

func Acquire() (*Lock, error) { return acquire() }

func (lock *Lock) Release() error {
	if lock == nil || lock.release == nil {
		return nil
	}
	release := lock.release
	lock.release = nil
	return release()
}
