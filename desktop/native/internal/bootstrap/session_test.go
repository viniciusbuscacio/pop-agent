package bootstrap

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

type memoryStore struct {
	values map[string]string
	setErr error
}

func (store *memoryStore) Get(account string) (string, error) {
	value := store.values[account]
	if value == "" {
		return "", errors.New("not found")
	}
	return value, nil
}

func (store *memoryStore) Set(account, token string) error {
	if store.setErr != nil {
		return store.setErr
	}
	store.values[account] = token
	return nil
}

func TestSessionTokenImportsThenRemovesBootstrap(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bootstrap-session.json")
	data, _ := json.Marshal(Session{ServerURL: "https://pop.example", Token: "secret-token"})
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{values: map[string]string{}}
	token, err := SessionToken(path, "https://pop.example", store)
	if err != nil || token != "secret-token" {
		t.Fatalf("import = %q, %v", token, err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("bootstrap still exists: %v", err)
	}
	if store.values["https://pop.example"] != token {
		t.Fatal("token was not imported into secure storage")
	}
}

func TestSessionTokenDoesNotRemoveBootstrapWhenStoreFails(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bootstrap-session.json")
	data, _ := json.Marshal(Session{ServerURL: "https://pop.example", Token: "secret-token"})
	_ = os.WriteFile(path, data, 0o600)
	store := &memoryStore{values: map[string]string{}, setErr: errors.New("denied")}
	if _, err := SessionToken(path, "https://pop.example", store); err == nil {
		t.Fatal("store failure was ignored")
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("bootstrap was removed after failed import: %v", err)
	}
}

func TestSessionTokenRejectsTrailingDataWithoutImport(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bootstrap-session.json")
	if err := os.WriteFile(path, []byte(`{"serverURL":"https://pop.example","token":"secret"} trailing`), 0o600); err != nil {
		t.Fatal(err)
	}
	store := &memoryStore{values: map[string]string{}}
	if _, err := SessionToken(path, "https://pop.example", store); err == nil {
		t.Fatal("trailing data was accepted")
	}
	if len(store.values) != 0 {
		t.Fatal("invalid bootstrap was imported")
	}
}

func TestSessionTokenFallsBackToStore(t *testing.T) {
	store := &memoryStore{values: map[string]string{"https://pop.example": "existing"}}
	token, err := SessionToken(filepath.Join(t.TempDir(), "missing.json"), "https://pop.example", store)
	if err != nil || token != "existing" {
		t.Fatalf("fallback = %q, %v", token, err)
	}
}
