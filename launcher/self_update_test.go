package main

import (
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

func TestLauncherUpdateVerifiesCandidateAndPreservesPrevious(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture is a POSIX executable")
	}
	binary := []byte("#!/bin/sh\necho 1.1.3\n")
	sum := sha256.Sum256(binary)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(binary) }))
	defer server.Close()
	l := testLauncher(t)
	destination := filepath.Join(t.TempDir(), "pop")
	writeExecutable(t, destination, "previous launcher")
	artifact := launcherArtifact{File: "pop-launcher-1.1.3-linux-amd64", Size: int64(len(binary)), SHA256: hex.EncodeToString(sum[:])}
	if err := l.installLauncher(server.URL, destination, "1.1.3", artifact); err != nil {
		t.Fatal(err)
	}
	previous, err := os.ReadFile(destination + ".previous")
	if err != nil || string(previous) != "previous launcher" {
		t.Fatalf("previous launcher lost: %s, %v", previous, err)
	}
	installed, _ := os.ReadFile(destination)
	if string(installed) != string(binary) {
		t.Fatal("verified candidate not installed")
	}
}

func TestLauncherUpdateFailureKeepsInstalledExecutable(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("fixture is a POSIX executable")
	}
	binary := []byte("#!/bin/sh\necho 1.1.3\n")
	sum := sha256.Sum256(binary)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { _, _ = w.Write(binary) }))
	defer server.Close()
	for _, kind := range []string{"checksum", "version"} {
		t.Run(kind, func(t *testing.T) {
			l := testLauncher(t)
			destination := filepath.Join(t.TempDir(), "pop")
			writeExecutable(t, destination, "working launcher")
			artifact := launcherArtifact{File: "candidate", Size: int64(len(binary)), SHA256: hex.EncodeToString(sum[:])}
			expected := "9.9.9"
			if kind == "checksum" {
				artifact.SHA256 = strings.Repeat("0", 64)
			}
			if err := l.installLauncher(server.URL, destination, expected, artifact); err == nil {
				t.Fatal("invalid candidate accepted")
			}
			installed, _ := os.ReadFile(destination)
			if string(installed) != "working launcher" {
				t.Fatal("installed launcher damaged")
			}
			if _, err := os.Stat(destination + ".candidate"); !os.IsNotExist(err) {
				t.Fatal("candidate leaked")
			}
		})
	}
}
