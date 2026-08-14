//go:build windows

package keychain

import (
	"errors"
	"fmt"

	"github.com/danieljoos/wincred"
	"golang.org/x/sys/windows"
)

type platformStore struct{}

func newPlatformStore() Store { return platformStore{} }

func credentialTarget(account string) string { return Service + "|" + account }

func (platformStore) Get(account string) (string, error) {
	credential, err := wincred.GetGenericCredential(credentialTarget(account))
	if errors.Is(err, windows.ERROR_NOT_FOUND) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("read session from Windows Credential Manager: %w", err)
	}
	if len(credential.CredentialBlob) == 0 {
		return "", ErrNotFound
	}
	return string(credential.CredentialBlob), nil
}

func (platformStore) Set(account, token string) error {
	if account == "" || token == "" {
		return errors.New("Credential Manager account and token must not be empty")
	}
	credential := wincred.NewGenericCredential(credentialTarget(account))
	credential.UserName = account
	credential.CredentialBlob = []byte(token)
	credential.Persist = wincred.PersistLocalMachine
	if err := credential.Write(); err != nil {
		return fmt.Errorf("store session in Windows Credential Manager: %w", err)
	}
	return nil
}

func (platformStore) Delete(account string) error {
	credential, err := wincred.GetGenericCredential(credentialTarget(account))
	if errors.Is(err, windows.ERROR_NOT_FOUND) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("find session in Windows Credential Manager: %w", err)
	}
	if err := credential.Delete(); err != nil && !errors.Is(err, windows.ERROR_NOT_FOUND) {
		return fmt.Errorf("delete session from Windows Credential Manager: %w", err)
	}
	return nil
}
