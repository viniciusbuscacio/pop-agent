package bootstrap

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
)

const maximumBootstrapBytes = 16 << 10

type Session struct {
	ServerURL string `json:"serverURL"`
	Token     string `json:"token"`
}

type TokenStore interface {
	Get(account string) (string, error)
	Set(account, token string) error
}

// SessionToken imports the setup wizard's one-time session into the Desktop
// Keychain identity. Subsequent launches read only Keychain; the bootstrap
// file is removed after a successful import.
func SessionToken(path, serverURL string, store TokenStore) (string, error) {
	file, err := os.Open(path)
	if err == nil {
		defer file.Close()
		info, statErr := file.Stat()
		if statErr != nil || info.Size() > maximumBootstrapBytes {
			return "", errors.New("setup session is too large")
		}
		var session Session
		decoder := json.NewDecoder(io.LimitReader(file, maximumBootstrapBytes+1))
		if err := decoder.Decode(&session); err != nil {
			return "", fmt.Errorf("decode setup session: %w", err)
		}
		if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
			return "", errors.New("setup session contains trailing data")
		}
		if session.ServerURL != serverURL || session.Token == "" {
			return "", errors.New("setup session does not match the configured server")
		}
		if err := store.Set(serverURL, session.Token); err != nil {
			return "", err
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("remove imported setup session: %w", err)
		}
		return session.Token, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("read setup session: %w", err)
	}
	return store.Get(serverURL)
}
