package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestNewerTrayVersion(t *testing.T) {
	for _, c := range []struct {
		a, b string
		want bool
	}{{"0.2.10", "0.2.9", true}, {"0.2.9", "0.2.10", false}, {"1.0.0", "0.99.9", true}, {"0.2.9", "0.2.9", false}, {"oops", "0.2.9", false}, {"999999999999.0.0", "0.2.9", false}} {
		if newerVersion(c.a, c.b) != c.want {
			t.Fatalf("comparison %s %s", c.a, c.b)
		}
	}
}
func TestInstallerMetadataAndDownload(t *testing.T) {
	bytes := []byte("verified installer")
	hash := sha256.Sum256(bytes)
	update := installerUpdate{Version: "0.3.0", File: "pop-local-access-0.3.0-darwin-arm64-setup.dmg", Size: int64(len(bytes)), SHA256: hex.EncodeToString(hash[:])}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" {
			t.Error("Unexpected credential")
		}
		if r.URL.Path == "/local-access-update.json" {
			_ = json.NewEncoder(w).Encode(update)
		} else {
			_, _ = w.Write(bytes)
		}
	}))
	defer server.Close()
	metadata, err := checkInstaller(context.Background(), server.URL, "darwin", "arm64")
	if err != nil || metadata.File != update.File {
		t.Fatalf("metadata: %v", err)
	}
	downloads := t.TempDir()
	file, err := downloadInstaller(context.Background(), server.URL, downloads, *metadata)
	if err != nil {
		t.Fatal(err)
	}
	got, _ := os.ReadFile(file)
	if string(got) != string(bytes) {
		t.Fatal("wrong downloaded bytes")
	}
	update.File = "../escape.dmg"
	if _, err = checkInstaller(context.Background(), server.URL, "darwin", "arm64"); err == nil {
		t.Fatal("unsafe metadata accepted")
	}
}
func TestFailedDownloadRemovesPartialAndRejectsRedirects(t *testing.T) {
	data := []byte("good")
	hash := sha256.Sum256(data)
	update := installerUpdate{File: "pop-local-access-0.3.0-darwin-arm64-setup.dmg", Size: 4, SHA256: hex.EncodeToString(hash[:])}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("bad data")) }))
	defer server.Close()
	downloads := t.TempDir()
	if _, err := downloadInstaller(context.Background(), server.URL, downloads, update); err == nil {
		t.Fatal("corrupt file accepted")
	}
	entries, _ := os.ReadDir(downloads)
	if len(entries) != 0 {
		t.Fatal("partial download kept")
	}
	redirected := false
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected = true }))
	defer destination.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, destination.URL, 302) }))
	defer redirect.Close()
	if _, err := downloadInstaller(context.Background(), redirect.URL, downloads, update); err == nil || redirected {
		t.Fatal("redirect accepted")
	}
}
func TestInstallerRestoresPreviousBytesOnRestartFailure(t *testing.T) {
	root := t.TempDir()
	source, target := filepath.Join(root, "setup"), filepath.Join(root, "tray")
	_ = os.WriteFile(source, []byte("new"), 0755)
	_ = os.WriteFile(target, []byte("old"), 0755)
	profile := filepath.Join(root, "profiles.json")
	_ = os.WriteFile(profile, []byte("saved login"), 0600)
	calls := 0
	err := replaceInstalledTray(source, target, func(string) error {
		calls++
		if calls == 1 {
			return os.ErrPermission
		}
		return nil
	})
	if err == nil || calls != 2 {
		t.Fatal("no rollback")
	}
	bytes, _ := os.ReadFile(target)
	if string(bytes) != "old" {
		t.Fatal("old executable lost")
	}
	bytes, _ = os.ReadFile(profile)
	if string(bytes) != "saved login" {
		t.Fatal("profile changed")
	}
}
func TestSetupEntryIsSeparateFromInstalledTray(t *testing.T) {
	for _, name := range []string{"Pop Local Access Setup", "pop-local-access-0.3.0-windows-amd64-setup.exe"} {
		if !isSetupName(name) {
			t.Fatal("setup entry missed")
		}
	}
	if isSetupName("Pop Local Access") || isSetupName("pop-local-access.exe") {
		t.Fatal("normal tray opens installer")
	}
}
