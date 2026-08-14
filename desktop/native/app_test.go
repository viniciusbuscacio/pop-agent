package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/config"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/keychain"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/serverclient"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/status"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/tray"
)

type memoryKeychain struct {
	values  map[string]string
	deleted []string
}

func (m *memoryKeychain) Get(account string) (string, error) {
	value, ok := m.values[account]
	if !ok {
		return "", keychain.ErrNotFound
	}
	return value, nil
}
func (m *memoryKeychain) Set(account, token string) error {
	m.values[account] = token
	return nil
}
func (m *memoryKeychain) Delete(account string) error {
	delete(m.values, account)
	m.deleted = append(m.deleted, account)
	return nil
}

func TestConnectPersistsURLButNotPasswordAndStoresToken(t *testing.T) {
	const password = "a password that must never be stored"
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/login" {
			http.NotFound(response, request)
			return
		}
		var body map[string]string
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if body["password"] != password {
			t.Fatalf("password = %q", body["password"])
		}
		_, _ = response.Write([]byte(`{"token":"session-token"}`))
	}))
	defer server.Close()

	path := filepath.Join(t.TempDir(), "config.json")
	keys := &memoryKeychain{values: map[string]string{}}
	app := NewApp()
	app.configPath = path
	app.config = config.Default()
	app.keychain = keys
	app.server = serverclient.NewWithHTTP(server.Client())

	got, err := app.Connect(server.URL, password)
	if err != nil {
		t.Fatal(err)
	}
	if got.Status.Server.State != status.Connected {
		t.Fatalf("server state = %q", got.Status.Server.State)
	}
	if keys.values[server.URL] != "session-token" {
		t.Fatalf("stored token = %q", keys.values[server.URL])
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) == "" || strings.Contains(string(data), password) || strings.Contains(string(data), "session-token") {
		t.Fatalf("config contains a secret: %s", data)
	}
}

func TestProbeInvalidSessionDeletesKeychainToken(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
		_, _ = response.Write([]byte(`{"error":{"code":"invalid_session","message":"Sign in again."}}`))
	}))
	defer server.Close()
	keys := &memoryKeychain{values: map[string]string{server.URL: "expired"}}
	app := NewApp()
	app.config = config.Default()
	app.config.ServerURL = server.URL
	app.keychain = keys
	app.server = serverclient.NewWithHTTP(server.Client())

	err := app.probeStoredSession(context.Background(), server.URL)
	if !serverclient.IsKind(err, serverclient.InvalidSession) {
		t.Fatalf("probe error = %v", err)
	}
	if len(keys.deleted) != 1 || keys.deleted[0] != server.URL {
		t.Fatalf("deleted accounts = %v", keys.deleted)
	}
	if app.snapshot().Status.Server.State != status.AuthenticationRequired {
		t.Fatalf("server state = %q", app.snapshot().Status.Server.State)
	}
}

func TestDesktopPathForExecutableRecognizesOnlyAppBundle(t *testing.T) {
	bundle := filepath.Join(string(filepath.Separator), "Applications", "Pop Desktop.app")
	executable := filepath.Join(bundle, "Contents", "MacOS", "Pop Desktop")
	if got := desktopPathForExecutable(executable); got != bundle {
		t.Fatalf("desktop path = %q, want %q", got, bundle)
	}
	if got := desktopPathForExecutable(filepath.Join(t.TempDir(), "Pop Desktop")); got != "" {
		t.Fatalf("non-bundle executable resolved to %q", got)
	}
	if got := desktopPathForExecutable(filepath.Join(bundle, "Contents", "MacOS", "other")); got != "" {
		t.Fatalf("wrong executable resolved to %q", got)
	}
}

func TestEnvWithPathPrependsDetectedNodeWithoutDroppingEnvironment(t *testing.T) {
	got := envWithPath("/node/bin", []string{"HOME=/tmp/home", "PATH=/usr/bin:/bin"})
	if strings.Join(got, "|") != "HOME=/tmp/home|PATH=/node/bin:/usr/bin:/bin" {
		t.Fatalf("environment = %v", got)
	}
}

func TestConnectedStatusTextIncludesLastCheckTime(t *testing.T) {
	checkedAt := time.Date(2026, time.August, 11, 13, 59, 7, 0, time.Local)
	if got, want := connectedStatusText(checkedAt), "Connected  ·  11/08/2026 13:59:07"; got != want {
		t.Fatalf("connected status = %q, want %q", got, want)
	}
}

func TestIndicatorForComponentState(t *testing.T) {
	tests := []struct {
		state status.State
		want  tray.Indicator
	}{
		{status.Connected, tray.IndicatorGood},
		{status.Checking, tray.IndicatorWarning},
		{status.Connecting, tray.IndicatorWarning},
		{status.AuthenticationRequired, tray.IndicatorWarning},
		{status.UpdateRequired, tray.IndicatorWarning},
		{status.Offline, tray.IndicatorBad},
		{status.NotConfigured, tray.IndicatorNeutral},
		{status.NotInstalled, tray.IndicatorNeutral},
		{status.Stopped, tray.IndicatorNeutral},
	}
	for _, test := range tests {
		if got := indicatorFor(test.state); got != test.want {
			t.Errorf("indicatorFor(%q) = %d, want %d", test.state, got, test.want)
		}
	}
}

func TestProbeWithoutTokenRequiresAuthentication(t *testing.T) {
	app := NewApp()
	app.config = config.Default()
	app.config.ServerURL = "https://pop.example.com"
	app.keychain = &memoryKeychain{values: map[string]string{}}
	if err := app.probeStoredSession(context.Background(), app.config.ServerURL); err == nil {
		t.Fatal("expected authentication error")
	}
	if app.snapshot().Status.Server.State != status.AuthenticationRequired {
		t.Fatalf("server state = %q", app.snapshot().Status.Server.State)
	}
}
