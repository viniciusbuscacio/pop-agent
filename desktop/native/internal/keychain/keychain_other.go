//go:build !darwin

package keychain

import "errors"

type platformStore struct{}

func newPlatformStore() Store { return platformStore{} }

func (platformStore) Get(string) (string, error) {
	return "", errors.New("Keychain is supported only on macOS")
}
func (platformStore) Set(string, string) error {
	return errors.New("Keychain is supported only on macOS")
}
func (platformStore) Delete(string) error { return errors.New("Keychain is supported only on macOS") }
