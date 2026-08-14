package config

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestLoadOrCreateUsesDefaultsAndPrivatePermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "config.json")
	got, err := LoadOrCreate(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != Default() {
		t.Fatalf("got %+v, want %+v", got, Default())
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("config permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestSaveAndLoadRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	want := Default()
	want.LocalPort = 14521
	want.StartAtLogin = true
	if err := Save(path, want); err != nil {
		t.Fatal(err)
	}
	got, err := LoadOrCreate(path)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("got %+v, want %+v", got, want)
	}
}

func TestLoadRejectsUnknownSchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"schemaVersion":99}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadOrCreate(path); err == nil {
		t.Fatal("expected unsupported schema error")
	}
}
