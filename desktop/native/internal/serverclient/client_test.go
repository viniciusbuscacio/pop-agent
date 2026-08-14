package serverclient

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestNormalizeURL(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
		ok   bool
	}{
		{name: "https remote", raw: " https://pop.example.com/ ", want: "https://pop.example.com", ok: true},
		{name: "http ipv4 loopback", raw: "http://127.0.0.1:8787", want: "http://127.0.0.1:8787", ok: true},
		{name: "http ipv6 loopback", raw: "http://[::1]:8787/", want: "http://[::1]:8787", ok: true},
		{name: "reject remote http", raw: "http://pop.example.com", ok: false},
		{name: "reject path", raw: "https://pop.example.com/login", ok: false},
		{name: "reject credentials", raw: "https://name:secret@pop.example.com", ok: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NormalizeURL(test.raw)
			if test.ok && (err != nil || got != test.want) {
				t.Fatalf("NormalizeURL() = %q, %v; want %q", got, err, test.want)
			}
			if !test.ok && err == nil {
				t.Fatalf("NormalizeURL() = %q; want error", got)
			}
		})
	}
}

func TestLoginAndSessionRenewal(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		switch request.URL.Path {
		case "/v1/login":
			response.Header().Set("Content-Type", "application/json")
			_, _ = response.Write([]byte(`{"token":"session-one"}`))
		case "/v1/settings":
			if request.Header.Get("Authorization") != "Bearer session-one" {
				t.Errorf("Authorization = %q", request.Header.Get("Authorization"))
			}
			response.Header().Set(sessionTokenHeader, "session-two")
			_, _ = response.Write([]byte(`{}`))
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()

	client := NewWithHTTP(server.Client())
	token, err := client.Login(context.Background(), server.URL, "password")
	if err != nil || token != "session-one" {
		t.Fatalf("Login() = %q, %v", token, err)
	}
	renewed, err := client.ProbeSession(context.Background(), server.URL, token)
	if err != nil || renewed != "session-two" {
		t.Fatalf("ProbeSession() = %q, %v", renewed, err)
	}
}

func TestCurrentVersionUsesSessionAndReturnsRenewal(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/update/status" || request.Header.Get("Authorization") != "Bearer session" {
			http.Error(response, "bad request", http.StatusBadRequest)
			return
		}
		response.Header().Set(sessionTokenHeader, "renewed")
		_, _ = response.Write([]byte(`{"popAgent":{"current":"0.2.6"}}`))
	}))
	defer server.Close()
	version, renewed, err := NewWithHTTP(server.Client()).CurrentVersion(context.Background(), server.URL, "session")
	if err != nil || version != "0.2.6" || renewed != "renewed" {
		t.Fatalf("CurrentVersion() = %q, %q, %v", version, renewed, err)
	}
}

func TestDesktopReleaseAndDownloadStayOnTheConfiguredOrigin(t *testing.T) {
	payload := []byte("signed desktop zip")
	digest := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer session" {
			http.Error(response, "missing session", http.StatusUnauthorized)
			return
		}
		switch request.URL.Path {
		case "/v1/desktop/release":
			_, _ = response.Write([]byte(`{"version":"0.2.6","platform":"darwin","arch":"arm64","sha256":"` + hex.EncodeToString(digest[:]) + `","size":18,"downloadPath":"/v1/desktop/package/pop-desktop-0.2.6-darwin-arm64.zip"}`))
		case "/v1/desktop/package/pop-desktop-0.2.6-darwin-arm64.zip":
			response.Header().Set(sessionTokenHeader, "renewed")
			_, _ = response.Write(payload)
		default:
			http.NotFound(response, request)
		}
	}))
	defer server.Close()
	client := NewWithHTTP(server.Client())
	release, _, err := client.DesktopRelease(context.Background(), server.URL, "session")
	if err != nil {
		t.Fatal(err)
	}
	var downloaded bytes.Buffer
	renewed, err := client.DownloadDesktop(context.Background(), server.URL, "session", release, &downloaded)
	if err != nil || renewed != "renewed" || !bytes.Equal(downloaded.Bytes(), payload) {
		t.Fatalf("DownloadDesktop() = %q, %q, %v", downloaded.Bytes(), renewed, err)
	}
	release.DownloadPath = "https://attacker.example/package.zip"
	if _, err := client.DownloadDesktop(context.Background(), server.URL, "session", release, &downloaded); err == nil {
		t.Fatal("DownloadDesktop accepted an arbitrary package origin")
	}
}

func TestDesktopDownloadRejectsChecksumMismatch(t *testing.T) {
	release := DesktopRelease{Version: "0.2.6", Platform: "darwin", Arch: "arm64", SHA256: strings.Repeat("0", 64), Size: 3, DownloadPath: "/v1/desktop/package/pop-desktop-0.2.6-darwin-arm64.zip"}
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) { _, _ = response.Write([]byte("bad")) }))
	defer server.Close()
	if _, err := NewWithHTTP(server.Client()).DownloadDesktop(context.Background(), server.URL, "session", release, &bytes.Buffer{}); err == nil {
		t.Fatal("DownloadDesktop accepted a checksum mismatch")
	}
}

func TestLoginClassifiesCredentialsAndOffline(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
		_, _ = response.Write([]byte(`{"error":{"code":"invalid_credentials","message":"That did not match. Try again."}}`))
	}))
	client := NewWithHTTP(server.Client())
	if _, err := client.Login(context.Background(), server.URL, "wrong"); !IsKind(err, InvalidCredentials) {
		t.Fatalf("Login credential error = %v", err)
	}
	server.Close()
	if _, err := client.Login(context.Background(), server.URL, "password"); !IsKind(err, Offline) {
		t.Fatalf("Login offline error = %v", err)
	}
}

func TestLoginDoesNotFollowRedirectsWithPassword(t *testing.T) {
	redirected := false
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		redirected = true
	}))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		http.Redirect(response, request, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	if _, err := New().Login(context.Background(), server.URL, "password"); !IsKind(err, UnexpectedResponse) {
		t.Fatalf("redirect response error = %v", err)
	}
	if redirected {
		t.Fatal("login followed a redirect and replayed the password")
	}
}

func TestProbeClassifiesInvalidSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusUnauthorized)
		_, _ = response.Write([]byte(`{"error":{"code":"invalid_session","message":"Sign in again."}}`))
	}))
	defer server.Close()
	if _, err := NewWithHTTP(server.Client()).ProbeSession(context.Background(), server.URL, "expired"); !IsKind(err, InvalidSession) {
		t.Fatalf("ProbeSession error = %v", err)
	}
}
