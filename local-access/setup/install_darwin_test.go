//go:build darwin

package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"
)

func TestMacComponentTransactions(t *testing.T) {
	for _, selection := range []Components{{Desktop: true}, {CLI: true}, {Desktop: true, CLI: true}} {
		t.Run(stringBool(selection.Desktop)+stringBool(selection.CLI), func(t *testing.T) {
			a := fixtureSetup(t, selection)
			if e := a.performInstall(context.Background(), a.state.Server, ""); e != nil {
				t.Fatal(e)
			}
			if regularFile(desktopExecutable()) != selection.Desktop || regularFile(filepath.Join(a.installDir, "cli", "pop")) != selection.CLI {
				t.Fatal("wrong installed components")
			}
			if !regularFile(a.launcherPath) {
				t.Fatal("private launcher missing")
			}
			if !selection.CLI {
				for _, p := range shellFiles() {
					if regularFile(p) {
						t.Fatal("Desktop-only installation changed shell PATH")
					}
				}
			}
			profile, e := readProfile(a.profilePath)
			if e != nil || profile.token != "fixture-token" {
				t.Fatal("profile lost")
			}
		})
	}
}
func TestMacInstallFailureRestoresFiles(t *testing.T) {
	a := fixtureSetup(t, Components{Desktop: true, CLI: true})
	before, _ := os.ReadFile(a.profilePath)
	a.signApp = func(context.Context) error { return errors.New("fixture signing failure") }
	if e := a.performInstall(context.Background(), a.state.Server, ""); e == nil {
		t.Fatal("expected failure")
	}
	after, _ := os.ReadFile(a.profilePath)
	if string(before) != string(after) {
		t.Fatal("failed install changed profile")
	}
	if regularFile(desktopExecutable()) || regularFile(a.launcherPath) {
		t.Fatal("failed install retained new executables")
	}
}
func TestMacPreparationFailureDoesNotReplace(t *testing.T) {
	a := fixtureSetup(t, Components{Desktop: true})
	a.prepare = func(context.Context, string, string, ...string) error { return errors.New("fixture offline") }
	if e := a.performInstall(context.Background(), a.state.Server, ""); e == nil {
		t.Fatal("expected failure")
	}
	if regularFile(desktopExecutable()) {
		t.Fatal("offline preparation installed app")
	}
}
func stringBool(b bool) string {
	if b {
		return "1"
	}
	return "0"
}
func fixtureSetup(t *testing.T, selection Components) *Setup {
	t.Helper()
	home, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("HOME", home)
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(home, ".config"))
	t.Setenv("ZDOTDIR", home)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/settings" || r.Header.Get("Authorization") != "Bearer fixture-token" {
			w.WriteHeader(401)
			return
		}
		w.WriteHeader(200)
	}))
	t.Cleanup(server.Close)
	dir, launcher, profile, _ := installPaths()
	b, _ := updatedProfiles(profileSnapshot{}, server.URL, "fixture-token")
	if e := atomicFile(profile, b, 0600); e != nil {
		t.Fatal(e)
	}
	executable, _ := os.Executable()
	binary, e := os.ReadFile(executable)
	if e != nil {
		t.Fatal(e)
	}
	sum := sha256.Sum256(binary)
	entry := payloadEntry{File: "tray", Size: len(binary), SHA256: hex.EncodeToString(sum[:])}
	manifest := payloadManifest{Platform: "darwin", Version: version, Tray: entry, Launcher: entry}
	manifest.Launcher.File = "launcher"
	metadata, _ := json.Marshal(manifest)
	return &Setup{ctx: context.Background(), initialized: true, installDir: dir, launcherPath: launcher, profilePath: profile, state: State{Server: server.URL, Components: selection}, source: fstest.MapFS{"manifest.json": {Data: metadata}, "tray": {Data: binary}, "launcher": {Data: binary}, "app.icns": {Data: []byte("fixture-icon")}}, prepare: func(context.Context, string, string, ...string) error { return nil }, stopProcesses: func(context.Context) error { return nil }, signApp: func(context.Context) error { return nil }}
}
