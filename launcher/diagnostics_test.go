package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestManifestFailureClassificationAndPrivacy(t *testing.T) {
	for _, tc := range []struct {
		status int
		code   string
	}{{404, "client_distribution_missing"}, {401, "client_manifest_access_denied"}, {403, "client_manifest_access_denied"}, {429, "client_manifest_rate_limited"}, {503, "server_http_error"}, {200, "client_manifest_invalid"}, {0, "server_connection_failed"}} {
		err := manifestFailure("https://user:secret@pop.example/cli/manifest.json?token=secret#secret", tc.status, errors.New("body with secret"))
		got := err.Error()
		if !strings.Contains(got, tc.code) || !strings.Contains(got, "GET https://pop.example/cli/manifest.json") {
			t.Fatalf("unexpected diagnostic: %s", got)
		}
		if strings.Contains(got, "secret") || strings.Contains(got, "user:") {
			t.Fatalf("secret in diagnostic: %s", got)
		}
		if tc.status == 404 && strings.Contains(got, "unreachable") {
			t.Fatal(got)
		}
	}
	err := manifestFailure("https://pop.example/cli/manifest.json", 0, context.DeadlineExceeded)
	if !strings.Contains(describeNetworkError(err), "timed out") || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal(err)
	}
}
func TestAllManifestRequestsIdentifyFailingEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Error(w, "secret response body", 404) }))
	defer server.Close()
	l := testLauncher(t)
	_, cliErr := l.fetchManifest(server.URL)
	_, launcherErr := l.fetchLauncherManifest(server.URL)
	_, runtimeErr := l.fetchRuntimeManifest(server.URL)
	for path, err := range map[string]error{"/cli/manifest.json": cliErr, "/cli/launcher/manifest.json": launcherErr, "/runtime/node/manifest.json": runtimeErr} {
		if err == nil || !strings.Contains(err.Error(), path) || !strings.Contains(err.Error(), "HTTP 404") || strings.Contains(err.Error(), "secret response body") {
			t.Fatalf("%s: %v", path, err)
		}
	}
}
func TestHTMLSuccessResponseIsDiagnosedAsInvalidDistribution(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write([]byte("<html>private content</html>")) }))
	defer server.Close()
	l := testLauncher(t)
	_, err := l.fetchManifest(server.URL)
	if err == nil || !strings.Contains(err.Error(), "client_manifest_invalid") || !strings.Contains(err.Error(), "HTTP 200") || strings.Contains(err.Error(), "private content") {
		t.Fatal(err)
	}
}
func TestDoctorChecksLauncherManifestWithoutUpdating(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.NotFound(w, r) }))
	defer server.Close()
	l := testLauncher(t)
	writeProfile(t, l, server.URL)
	if l.doctor(nil) != 1 {
		t.Fatal("missing manifest reported healthy")
	}
	got := l.stdout.(*strings.Builder).String()
	if !strings.Contains(got, "Launcher bootstrap: failed") || !strings.Contains(got, "/cli/launcher/manifest.json") || strings.Contains(got, "Server: unreachable") {
		t.Fatal(got)
	}
}
