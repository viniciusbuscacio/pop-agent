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
	"strings"
	"testing"
	"testing/fstest"
)

func TestOrigins(t *testing.T) {
	for _, value := range []string{"https://pop.example.test", "http://127.0.0.1:8787/", "http://[::1]:8787"} {
		if _, err := serverOrigin(value); err != nil {
			t.Errorf("rejected %s", value)
		}
	}
	for _, value := range []string{"http://remote.test", "https://user:password@pop.test", "https://pop.test/a", "https://pop.test?token=x", "https://pop.test#x", "file:///tmp/a", "javascript:alert(1)"} {
		if _, err := serverOrigin(value); err == nil {
			t.Errorf("accepted unsafe %s", value)
		}
	}
	if got := originFromDownload([]byte("[ZoneTransfer]\nHostUrl=https://pop.test/local-access/file.exe\n")); got != "https://pop.test" {
		t.Fatal(got)
	}
	if got := originFromDownload([]byte("HostUrl=https://user:pass@pop.test/file.exe")); got != "" {
		t.Fatal("accepted credential-bearing suggestion")
	}
}
func TestPayloadIntegrity(t *testing.T) {
	bytes := []byte("MZ-test-payload")
	sum := sha256.Sum256(bytes)
	entry := payloadEntry{File: "tray.exe", Size: len(bytes), SHA256: hex.EncodeToString(sum[:])}
	manifest := payloadManifest{Version: version, Tray: entry, Launcher: entry}
	manifest.Launcher.File = "launcher.exe"
	data, _ := json.Marshal(manifest)
	files := fstest.MapFS{"manifest.json": {Data: data}, "tray.exe": {Data: bytes}, "launcher.exe": {Data: bytes}}
	if _, err := verifiedPayload(files); err != nil {
		t.Fatal(err)
	}
	files["tray.exe"] = &fstest.MapFile{Data: []byte("MZ-corrupt")}
	if _, err := verifiedPayload(files); err == nil {
		t.Fatal("accepted corrupt payload")
	}
	manifest.Tray.File = "../tray.exe"
	data, _ = json.Marshal(manifest)
	files["manifest.json"] = &fstest.MapFile{Data: data}
	if _, err := verifiedPayload(files); err == nil {
		t.Fatal("accepted traversal")
	}
	if _, err := verifiedPayload(fstest.MapFS{}); err == nil {
		t.Fatal("source-only build allowed installation")
	}
}
func TestPreservesProfilesAndDetectsConcurrentChanges(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	original := []byte(`{"default":{"url":"https://old.test","token":"old","extra":42},"work":{"url":"https://work.test","token":"work"}}`)
	if err := os.WriteFile(path, original, 0600); err != nil {
		t.Fatal(err)
	}
	before, err := readProfile(path)
	if err != nil {
		t.Fatal(err)
	}
	result, err := updatedProfiles(before, "https://new.test", "new-token")
	if err != nil {
		t.Fatal(err)
	}
	var profiles map[string]map[string]any
	if err = json.Unmarshal(result, &profiles); err != nil {
		t.Fatal(err)
	}
	if profiles["work"]["token"] != "work" || profiles["default"]["extra"] != float64(42) {
		t.Fatal("lost unrelated profile data")
	}
	if !unchangedProfile(path, before) {
		t.Fatal("false conflict")
	}
	_ = os.WriteFile(path, []byte(`{"default":{"token":"changed"}}`), 0600)
	if unchangedProfile(path, before) {
		t.Fatal("missed concurrent edit")
	}
	_ = os.WriteFile(path, []byte("not json"), 0600)
	if _, err = readProfile(path); err == nil {
		t.Fatal("accepted corrupt profiles")
	}
}
func TestLoginRejectsRedirectsAndRedactsErrors(t *testing.T) {
	var redirected bool
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected = true; w.WriteHeader(200) }))
	defer target.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 302) }))
	defer origin.Close()
	if _, err := login(context.Background(), origin.URL, "private-password"); err == nil || strings.Contains(err.Error(), "private-password") {
		t.Fatal("unsafe login error")
	}
	if redirected {
		t.Fatal("password followed redirect")
	}
	valid := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v1/login" {
			t.Error("wrong request")
		}
		_, _ = w.Write([]byte(`{"token":"fixture-token"}`))
	}))
	defer valid.Close()
	token, err := login(context.Background(), valid.URL, "fixture-password")
	if err != nil || token != "fixture-token" {
		t.Fatal(err)
	}
}
func TestAtomicFileRefusesNonRegularDestination(t *testing.T) {
	path := filepath.Join(t.TempDir(), "directory")
	_ = os.Mkdir(path, 0700)
	if err := atomicFile(path, []byte("data"), 0600); err == nil {
		t.Fatal("overwrote directory")
	}
}
