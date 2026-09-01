package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestNormalizeServerURL(t *testing.T) {
	got, err := normalizeServerURL(" https://pop.example/ ")
	if err != nil || got != "https://pop.example" {
		t.Fatalf("got %q, %v", got, err)
	}
	for _, value := range []string{"pop.example", "https://pop.example/path", "http://pop.example", "file:///tmp/pop"} {
		if _, err := normalizeServerURL(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
	for _, value := range []string{"http://localhost:8787", "http://127.0.0.1:8787", "http://[::1]:8787"} {
		if _, err := normalizeServerURL(value); err != nil {
			t.Fatalf("expected loopback URL %q to be accepted: %v", value, err)
		}
	}
}

func TestVersionComparisonNeverDowngrades(t *testing.T) {
	if compareVersions("0.10.0", "0.9.9") <= 0 {
		t.Fatal("numeric version comparison regressed")
	}
	if compareVersions("0.2.0", "0.2.0") != 0 || compareVersions("0.2.0", "0.2.1") >= 0 {
		t.Fatal("version ordering is wrong")
	}
}

func TestVersionCommandsStartInstalledCLILocally(t *testing.T) {
	for _, command := range []string{"version", "--version", "-v"} {
		t.Run(command, func(t *testing.T) {
			requests := 0
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests++
				http.Error(w, "version must not request the server", http.StatusInternalServerError)
			}))
			defer server.Close()

			l := testLauncher(t)
			writeProfile(t, l, server.URL)
			st := state{ActiveVersion: "0.2.42"}
			if err := l.writeState(st); err != nil {
				t.Fatal(err)
			}
			entry := cliEntry(filepath.Join(l.home, ".pop", "cli", st.ActiveVersion))
			if err := os.MkdirAll(filepath.Dir(entry), 0700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(entry, []byte("installed CLI"), 0600); err != nil {
				t.Fatal(err)
			}
			l.lookPath = func(name string) (string, error) { return "/local/node", nil }
			var launchedArgs []string
			l.execute = func(node, gotEntry string, args []string) (int, error) {
				if node != "/local/node" || gotEntry != entry {
					t.Fatalf("started %q with %q", gotEntry, node)
				}
				launchedArgs = append([]string(nil), args...)
				fmt.Fprintln(l.stdout, "0.2.42")
				return 0, nil
			}

			if code := l.run([]string{command}); code != 0 {
				t.Fatalf("run returned %d: %s", code, l.stderr.(*strings.Builder).String())
			}
			if requests != 0 {
				t.Fatalf("version made %d server requests", requests)
			}
			if strings.Join(launchedArgs, " ") != command {
				t.Fatalf("CLI started with %#v", launchedArgs)
			}
			if got := l.stdout.(*strings.Builder).String(); got != "0.2.42\n" {
				t.Fatalf("version output = %q", got)
			}
		})
	}
}

func TestOfflineServerStopsBeforeStartingCLI(t *testing.T) {
	l := testLauncher(t)
	writeProfile(t, l, "http://127.0.0.1:1")
	started := false
	l.execute = func(string, string, []string) (int, error) {
		started = true
		return 0, nil
	}
	if code := l.run(nil); code == 0 {
		t.Fatal("offline launch unexpectedly succeeded")
	}
	if started {
		t.Fatal("CLI started while its server was offline")
	}
	if !strings.Contains(l.stderr.(*strings.Builder).String(), "Could not connect") {
		t.Fatal("missing actionable connection error")
	}
}

func TestFirstRunInstallsAtomicallyAndStartsLogin(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("test helper scripts use POSIX shell")
	}
	archive := []byte("immutable cli package")
	hash := sha256.Sum256(archive)
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/cli/manifest.json":
			_ = json.NewEncoder(w).Encode(manifest{
				Version:                "0.3.0",
				MinimumNodeVersion:     "22.19.0",
				MinimumLauncherVersion: "1.0.0",
				Package: manifestPackage{
					URL:    "/cli-0.3.0.tgz",
					Size:   int64(len(archive)),
					SHA256: hex.EncodeToString(hash[:]),
				},
			})
		case "/cli-0.3.0.tgz":
			_, _ = w.Write(archive)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	l := testLauncher(t)
	l.stdin = strings.NewReader(server.URL + "\n")
	bin := t.TempDir()
	node := filepath.Join(bin, "node")
	npm := filepath.Join(bin, "npm")
	writeExecutable(t, node, `#!/bin/sh
if [ "$1" = "--version" ]; then echo v22.19.0; exit 0; fi
if [ "$2" = "--version" ]; then cat "$1"; exit 0; fi
exit 2
`)
	writeExecutable(t, npm, `#!/bin/sh
while [ "$#" -gt 0 ]; do
  last="$1"
  if [ "$1" = "--prefix" ]; then prefix="$2"; shift 2; continue; fi
  if [ "$1" = "--registry" ]; then registry="$2"; shift 2; continue; fi
  shift
done
[ "$registry" = "https://packagefeedproxy.microsoft.io/npm/" ] || exit 8
[ "${last##*.}" = "tgz" ] || exit 9
mkdir -p "$prefix/node_modules/pop-agent/dist"
printf '0.3.0\n' > "$prefix/node_modules/pop-agent/dist/main.js"
`)
	l.lookPath = func(name string) (string, error) {
		if strings.HasPrefix(name, "npm") {
			return npm, nil
		}
		return node, nil
	}
	var launchedArgs []string
	l.execute = func(_ string, entry string, args []string) (int, error) {
		if _, err := os.Stat(entry); err != nil {
			t.Fatalf("active CLI missing: %v", err)
		}
		launchedArgs = append([]string(nil), args...)
		return 0, nil
	}

	if code := l.run(nil); code != 0 {
		t.Fatalf("run returned %d: %s", code, l.stderr.(*strings.Builder).String())
	}
	if strings.Join(launchedArgs, " ") != "login "+server.URL {
		t.Fatalf("first run started with %#v", launchedArgs)
	}
	st, err := l.readState()
	if err != nil || st.ActiveVersion != "0.3.0" {
		t.Fatalf("state = %#v, %v", st, err)
	}
	if _, err := os.Stat(filepath.Join(l.home, ".pop", "cli", ".staging-0.3.0")); !os.IsNotExist(err) {
		t.Fatal("staging directory remained after activation")
	}
}

func TestStaleUpdateLockCannotBrickFutureUpdates(t *testing.T) {
	l := testLauncher(t)
	path := filepath.Join(l.home, ".pop", "update.lock")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("dead process\n"), 0600); err != nil {
		t.Fatal(err)
	}
	old := time.Now().Add(-time.Hour)
	if err := os.Chtimes(path, old, old); err != nil {
		t.Fatal(err)
	}
	release, err := l.acquireInstallLock()
	if err != nil {
		t.Fatalf("stale lock was not recovered: %v", err)
	}
	release()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("released lock remained on disk")
	}
}

func TestPackageDownloadRejectsCrossOriginRedirect(t *testing.T) {
	payload := []byte("redirected package")
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(payload)
	}))
	defer destination.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL+"/package", http.StatusFound)
	}))
	defer source.Close()
	hash := sha256.Sum256(payload)
	l := testLauncher(t)
	err := l.download(source.URL+"/package", filepath.Join(t.TempDir(), "package.tgz"), manifestPackage{
		Size: int64(len(payload)), SHA256: hex.EncodeToString(hash[:]),
	})
	if err == nil || !strings.Contains(err.Error(), "redirected outside") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestChecksumFailureKeepsPreviousVersion(t *testing.T) {
	archive := []byte("corrupt")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(archive)
	}))
	defer server.Close()
	l := testLauncher(t)
	previous := state{ActiveVersion: "0.2.9"}
	if err := l.writeState(previous); err != nil {
		t.Fatal(err)
	}
	err := l.install(server.URL, manifest{
		Version: "0.3.0",
		Package: manifestPackage{URL: "/package", Size: int64(len(archive)), SHA256: strings.Repeat("0", 64)},
	}, tools{node: "node", npm: "npm"}, previous)
	if err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("unexpected error: %v", err)
	}
	st, _ := l.readState()
	if st.ActiveVersion != previous.ActiveVersion {
		t.Fatalf("active version changed to %q", st.ActiveVersion)
	}
}

func testLauncher(t *testing.T) *launcher {
	t.Helper()
	home := t.TempDir()
	return &launcher{
		stdin:      strings.NewReader(""),
		stdout:     &strings.Builder{},
		stderr:     &strings.Builder{},
		home:       home,
		configHome: filepath.Join(home, ".config"),
		http:       &http.Client{},
		lookPath:   exec.LookPath,
		command:    exec.Command,
		execute:    func(string, string, []string) (int, error) { return 0, nil },
	}
}

func writeProfile(t *testing.T, l *launcher, serverURL string) {
	t.Helper()
	path := filepath.Join(l.configHome, "pop-agent", "profiles.json")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(`{"default":{"url":"`+serverURL+`","token":"test"}}`), 0600); err != nil {
		t.Fatal(err)
	}
}

func writeExecutable(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0700); err != nil {
		t.Fatal(err)
	}
}

var _ io.Reader
