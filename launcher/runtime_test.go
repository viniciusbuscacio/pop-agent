package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestManagedRuntimeInstallIsPrivateVerifiedAndIdempotent(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("the pilot runtime package is tar.gz for Unix")
	}
	archive := runtimeArchive(t, map[string]runtimeArchiveEntry{
		"node-v22.23.2-test/":     {directory: true},
		"node-v22.23.2-test/bin/": {directory: true},
		"node-v22.23.2-test/bin/node": {mode: 0o755, body: `#!/bin/sh
if [ "$1" = "--version" ]; then echo v22.23.2; exit 0; fi
if [ "$2" = "--version" ]; then echo 10.9.8; exit 0; fi
exit 2
`},
		"node-v22.23.2-test/lib/":                                {directory: true},
		"node-v22.23.2-test/lib/node_modules/":                   {directory: true},
		"node-v22.23.2-test/lib/node_modules/npm/":               {directory: true},
		"node-v22.23.2-test/lib/node_modules/npm/bin/":           {directory: true},
		"node-v22.23.2-test/lib/node_modules/npm/bin/npm-cli.js": {body: "// npm"},
		"node-v22.23.2-test/bin/npm":                             {link: "../lib/node_modules/npm/bin/npm-cli.js"},
	})
	hash := sha256.Sum256(archive)
	downloads := 0
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/runtime/node/22.23.2/node-v22.23.2-test.tar.gz" {
			http.NotFound(response, request)
			return
		}
		downloads++
		_, _ = response.Write(archive)
	}))
	defer server.Close()

	launcher := testLauncher(t)
	release := runtimeManifest{
		Version: "22.23.2", Packages: map[string]runtimePackage{
			runtime.GOOS + "-" + runtime.GOARCH: {
				SourceURL: "https://nodejs.org/dist/v22.23.2/node-v22.23.2-test.tar.gz", Size: int64(len(archive)), SHA256: hex.EncodeToString(hash[:]),
			},
		},
	}
	if err := launcher.installManagedRuntime(server.URL, release); err != nil {
		t.Fatal(err)
	}
	state, err := launcher.readManagedRuntimeState()
	if err != nil {
		t.Fatal(err)
	}
	if state.InstalledVersion != "22.23.2" || state.Platform != runtime.GOOS || state.Arch != runtime.GOARCH {
		t.Fatalf("unexpected runtime state: %#v", state)
	}
	directory := launcher.managedRuntimeDirectory(state)
	if _, err := os.Stat(managedNodePath(directory)); err != nil {
		t.Fatalf("managed node missing: %v", err)
	}
	if _, err := os.Lstat(filepath.Join(directory, "bin", "npm")); !os.IsNotExist(err) {
		t.Fatal("archive symlink should not have been extracted")
	}
	if code := launcher.runtimeDoctor(); code != 0 {
		t.Fatalf("runtime doctor failed: %s", launcher.stdout.(*strings.Builder).String())
	}
	if !strings.Contains(launcher.stdout.(*strings.Builder).String(), "preferred private runtime for Pop CLI") {
		t.Fatal("runtime doctor still describes the activated runtime as staged")
	}
	launcher.lookPath = func(string) (string, error) { return "", os.ErrNotExist }
	managed, err := launcher.dependencies("22.19.0")
	if err != nil || managed.node != managedNodePath(directory) || managed.npm != managed.node {
		t.Fatalf("managed runtime was not selected for CLI install: %#v, %v", managed, err)
	}
	if err := launcher.installManagedRuntime(server.URL, release); err != nil {
		t.Fatal(err)
	}
	if downloads != 1 {
		t.Fatalf("idempotent install downloaded %d times", downloads)
	}
}

func TestManagedRuntimeChecksumFailureLeavesNoState(t *testing.T) {
	archive := []byte("not the expected archive")
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/runtime/node/22.23.2/node-v22.23.2-test.tar.gz" {
			http.NotFound(response, request)
			return
		}
		_, _ = response.Write(archive)
	}))
	defer server.Close()
	launcher := testLauncher(t)
	err := launcher.installManagedRuntime(server.URL, runtimeManifest{
		Version: "22.23.2", Packages: map[string]runtimePackage{
			runtime.GOOS + "-" + runtime.GOARCH: {
				SourceURL: "https://nodejs.org/dist/v22.23.2/node-v22.23.2-test.tar.gz", Size: int64(len(archive)), SHA256: strings.Repeat("0", 64),
			},
		},
	})
	if err == nil || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, err := launcher.readManagedRuntimeState(); !os.IsNotExist(err) {
		t.Fatalf("failed install wrote runtime state: %v", err)
	}
}

func TestRuntimeExtractionRejectsTraversalAndSpecialEntries(t *testing.T) {
	for name, entries := range map[string]map[string]runtimeArchiveEntry{
		"traversal": {
			"node-test/":             {directory: true},
			"node-test/../../escape": {body: "bad"},
		},
		"hardlink": {
			"node-test/":     {directory: true},
			"node-test/file": {hardlink: "elsewhere"},
		},
		"multiple roots": {
			"node-a/":     {directory: true},
			"node-b/file": {body: "bad"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			archive := runtimeArchive(t, entries)
			path := filepath.Join(t.TempDir(), "runtime.tar.gz")
			if err := os.WriteFile(path, archive, 0o600); err != nil {
				t.Fatal(err)
			}
			if err := extractNodeTarGz(path, t.TempDir()); err == nil {
				t.Fatal("unsafe archive was accepted")
			}
		})
	}
}

func TestRuntimeManifestAcceptsOnlyPinnedOfficialNodeDistribution(t *testing.T) {
	if !validOfficialNodeURL(
		"https://nodejs.org/dist/v22.23.2/node-v22.23.2-darwin-arm64.tar.gz",
		"22.23.2",
	) {
		t.Fatal("official pinned Node distribution URL was rejected")
	}
	for _, candidate := range []string{
		"https://example.com/dist/v22.23.2/node-v22.23.2-darwin-arm64.tar.gz",
		"http://nodejs.org/dist/v22.23.2/node-v22.23.2-darwin-arm64.tar.gz",
		"https://nodejs.org/dist/v22.23.1/node-v22.23.1-darwin-arm64.tar.gz",
		"https://nodejs.org/dist/v22.23.2/node-v22.23.2-darwin-arm64.tar.gz?mirror=1",
	} {
		if validOfficialNodeURL(candidate, "22.23.2") {
			t.Fatalf("untrusted Node distribution URL was accepted: %s", candidate)
		}
	}
}

type runtimeArchiveEntry struct {
	body      string
	mode      int64
	directory bool
	link      string
	hardlink  string
}

func runtimeArchive(t *testing.T, entries map[string]runtimeArchiveEntry) []byte {
	t.Helper()
	var output bytes.Buffer
	compressed := gzip.NewWriter(&output)
	archive := tar.NewWriter(compressed)
	for name, entry := range entries {
		header := &tar.Header{Name: name, Mode: entry.mode, Size: int64(len(entry.body)), Typeflag: tar.TypeReg}
		switch {
		case entry.directory:
			header.Typeflag = tar.TypeDir
			header.Size = 0
			header.Mode = 0o755
		case entry.link != "":
			header.Typeflag = tar.TypeSymlink
			header.Linkname = entry.link
			header.Size = 0
		case entry.hardlink != "":
			header.Typeflag = tar.TypeLink
			header.Linkname = entry.hardlink
			header.Size = 0
		case header.Mode == 0:
			header.Mode = 0o644
		}
		if err := archive.WriteHeader(header); err != nil {
			t.Fatal(err)
		}
		if header.Typeflag == tar.TypeReg {
			if _, err := archive.Write([]byte(entry.body)); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := compressed.Close(); err != nil {
		t.Fatal(err)
	}
	return output.Bytes()
}
