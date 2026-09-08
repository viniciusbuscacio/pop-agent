package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoginOriginPolicy(t *testing.T) {
	for _, value := range []string{"https://pop.example", "http://127.0.0.1:8787", "http://[::1]:8787"} {
		if !validLoginURL(value) {
			t.Fatalf("rejected %s", value)
		}
	}
	for _, value := range []string{"http://pop.example", "https://user:secret@pop.example", "https://pop.example?token=x", "https://pop.example#token", "file:///tmp/test", "https:///missing"} {
		if validLoginURL(value) {
			t.Fatalf("accepted %s", value)
		}
	}
}

func TestLoginUsesExistingPasswordEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.URL.Path != "/v1/login" || r.Header.Get("Content-Type") != "application/json" {
			t.Error("unexpected login request")
		}
		var body map[string]string
		if json.NewDecoder(r.Body).Decode(&body) != nil || body["password"] != "test password" {
			t.Error("password missing")
		}
		if r.Header.Get("Authorization") != "" {
			t.Error("must not send stale session")
		}
		_, _ = w.Write([]byte(`{"token":"new-session"}`))
	}))
	defer server.Close()
	token, err := requestLogin(context.Background(), server.URL, "test password")
	if err != nil || token != "new-session" {
		t.Fatalf("login failed: %v", err)
	}
}

func TestLoginRefusesRedirects(t *testing.T) {
	called := false
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true }))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, 307) }))
	defer server.Close()
	if _, err := requestLogin(context.Background(), server.URL, "private"); err == nil {
		t.Fatal("redirect accepted")
	}
	if called {
		t.Fatal("password forwarded")
	}
}

func TestLoginErrorsNeverExposeServerBody(t *testing.T) {
	for _, status := range []int{401, 429, 500, 200} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(status)
				_, _ = w.Write([]byte("private-server-response"))
			}))
			defer server.Close()
			_, err := requestLogin(context.Background(), server.URL, "private-password")
			if err == nil || strings.Contains(err.Error(), "private") {
				t.Fatal("unsafe or missing error")
			}
		})
	}
}

func TestSaveLoginPreservesOtherProfilesAndPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	data := `{"default":{"url":"https://pop.example","token":"old"},"other":{"url":"https://other.example","token":"keep"}}`
	if err := os.WriteFile(path, []byte(data), 0600); err != nil {
		t.Fatal(err)
	}
	_, previous, err := readProfiles(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := saveLogin(path, previous, "new"); err != nil {
		t.Fatal(err)
	}
	profiles, saved, err := readProfiles(path)
	if err != nil || saved.Token != "new" || !strings.Contains(string(profiles["other"]), "keep") {
		t.Fatal("profiles not preserved")
	}
	info, _ := os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal("token file is not owner-only")
	}
	if err := saveLogin(path, previous, "stale"); err == nil {
		t.Fatal("overwrote a newer login")
	}
}

func TestSaveLoginLeavesCorruptProfileUntouched(t *testing.T) {
	path := filepath.Join(t.TempDir(), "profiles.json")
	if err := os.WriteFile(path, []byte("corrupt"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := saveLogin(path, loginProfile{}, "new"); err == nil {
		t.Fatal("corrupt profile accepted")
	}
	data, _ := os.ReadFile(path)
	if string(data) != "corrupt" {
		t.Fatal("profile overwritten")
	}
}

func TestTrayInvalidatesAccessAndIgnoresOldChild(t *testing.T) {
	t.Setenv("HOME", t.TempDir())
	current := &exec.Cmd{}
	a := &app{command: current, accessKnown: true, accessEnabled: true}
	a.scan(strings.NewReader("{\"kind\":\"authentication-required\"}\n"), current)
	if a.accessKnown || a.status != "Sign-in required" {
		t.Fatal("stale live permission after authentication failure")
	}
	a.scan(strings.NewReader("{\"kind\":\"access-policy\",\"enabled\":true}\n"), &exec.Cmd{})
	if a.accessKnown {
		t.Fatal("old child restored stale permission")
	}
	a.scan(strings.NewReader("{\"kind\":\"access-policy\",\"enabled\":true}\n"), current)
	if !a.accessKnown || a.status != "Access enabled" {
		t.Fatal("live policy not applied")
	}
	a.scan(strings.NewReader("{\"kind\":\"closed\"}\n"), current)
	if a.accessKnown {
		t.Fatal("stale live permission after disconnect")
	}
}
