package setupinstall

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestInstallCreatesCompletePerUserProduct(t *testing.T) {
	home := t.TempDir()
	payload := filepath.Join(t.TempDir(), "Pop Desktop.app")
	helper := filepath.Join(payload, "Contents", "Helpers", "pop")
	if err := os.MkdirAll(filepath.Dir(helper), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(helper, []byte("launcher"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(payload, "Contents", "MacOS"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(payload, "Contents", "MacOS", "Pop Desktop"), []byte("desktop"), 0o755); err != nil {
		t.Fatal(err)
	}

	var commands [][]string
	configPath := filepath.Join(home, "Library", "Application Support", "Pop Agent", "config.json")
	installer := Installer{
		Home: home, ConfigPath: configPath, PayloadApp: payload,
		Now: func() time.Time { return time.Unix(0, 42) },
		Run: func(name string, args ...string) error {
			commands = append(commands, append([]string{name}, args...))
			return nil
		},
	}
	app, err := installer.Install(Credentials{ServerURL: "https://pop.example", Token: "session-secret"})
	if err != nil {
		t.Fatal(err)
	}
	if app != filepath.Join(home, "Applications", "Pop Desktop.app") {
		t.Fatalf("app path = %q", app)
	}
	if _, err := os.Stat(filepath.Join(app, "Contents", "MacOS", "Pop Desktop")); err != nil {
		t.Fatalf("desktop missing: %v", err)
	}
	launcher := filepath.Join(home, ".local", "bin", "pop")
	info, err := os.Stat(launcher)
	if err != nil {
		t.Fatalf("launcher missing: %v", err)
	}
	if info.Mode()&0o111 == 0 {
		t.Fatalf("launcher is not executable: %#o", info.Mode())
	}
	wantCommands := [][]string{
		{filepath.Join(home, "Applications", ".Pop Desktop.install-42", "Contents", "Helpers", "pop"), "runtime", "install"},
		{filepath.Join(home, "Applications", ".Pop Desktop.install-42", "Contents", "Helpers", "pop"), "update"},
	}
	if !reflect.DeepEqual(commands, wantCommands) {
		t.Fatalf("commands = %#v", commands)
	}

	var profiles map[string]cliProfile
	data, err := os.ReadFile(filepath.Join(home, ".config", "pop-agent", "profiles.json"))
	if err != nil || json.Unmarshal(data, &profiles) != nil {
		t.Fatalf("profile unreadable: %v", err)
	}
	if profiles["default"].Token != "session-secret" || profiles["default"].URL != "https://pop.example" {
		t.Fatalf("profile = %#v", profiles)
	}
	bootstrapData, err := os.ReadFile(filepath.Join(filepath.Dir(configPath), "bootstrap-session.json"))
	if err != nil || !strings.Contains(string(bootstrapData), "session-secret") {
		t.Fatalf("bootstrap missing: %v", err)
	}
	configData, err := os.ReadFile(configPath)
	if err != nil || strings.Contains(string(configData), "session-secret") {
		t.Fatalf("config contains credentials or is unreadable: %v", err)
	}
	zprofile, _ := os.ReadFile(filepath.Join(home, ".zprofile"))
	if strings.Count(string(zprofile), pathMarker) != 1 {
		t.Fatalf("unexpected .zprofile: %q", zprofile)
	}
}

func TestInstallPreservesExistingNamedProfiles(t *testing.T) {
	home := t.TempDir()
	path := filepath.Join(home, ".config", "pop-agent", "profiles.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"work":{"url":"https://work.example","token":"work-token"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	installer := Installer{Home: home}
	if err := installer.writeProfile(Credentials{ServerURL: "https://pop.example", Token: "new-token"}); err != nil {
		t.Fatal(err)
	}
	var profiles map[string]cliProfile
	data, _ := os.ReadFile(path)
	if err := json.Unmarshal(data, &profiles); err != nil {
		t.Fatal(err)
	}
	if profiles["work"].Token != "work-token" || profiles["default"].Token != "new-token" {
		t.Fatalf("profiles were not merged: %#v", profiles)
	}
}

func TestInstallRejectsMissingLauncherBeforeWritingCredentials(t *testing.T) {
	home := t.TempDir()
	configPath := filepath.Join(home, "config.json")
	_, err := (Installer{
		Home: home, ConfigPath: configPath, PayloadApp: t.TempDir(),
		Run: func(string, ...string) error { return nil },
	}).Install(Credentials{ServerURL: "https://pop.example", Token: "secret"})
	if err == nil {
		t.Fatal("missing launcher was accepted")
	}
	if _, statErr := os.Stat(configPath); !os.IsNotExist(statErr) {
		t.Fatalf("credentials were written before payload validation: %v", statErr)
	}
}
