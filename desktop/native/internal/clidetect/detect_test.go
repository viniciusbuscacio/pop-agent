package clidetect

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestInspectReadsInstalledPopPackage(t *testing.T) {
	root := t.TempDir()
	entry := filepath.Join(root, "lib", "node_modules", "pop-agent", "dist", "main.js")
	if err := os.MkdirAll(filepath.Dir(entry), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, []byte("#!/usr/bin/env node\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(root, "lib", "node_modules", "pop-agent", "package.json")
	if err := os.WriteFile(manifest, []byte(`{"name":"pop-agent","version":"0.2.4","bin":{"pop":"./dist/main.js"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	command := filepath.Join(root, "bin", "pop")
	result, err := inspect(command, entry)
	if err != nil {
		t.Fatal(err)
	}
	if result.CommandPath != command || result.EntryPath != entry || result.Version != "0.2.4" {
		t.Fatalf("unexpected result: %+v", result)
	}
}

func TestInspectRejectsUnrelatedPackage(t *testing.T) {
	root := t.TempDir()
	entry := filepath.Join(root, "other", "dist", "main.js")
	if err := os.MkdirAll(filepath.Dir(entry), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(entry, nil, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "other", "package.json"), []byte(`{"name":"other","version":"0.2.4","bin":{"pop":"x"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := inspect(entry, entry); err == nil {
		t.Fatal("expected unrelated package to be rejected")
	}
}

func TestVersionCommandMustMatchPackageManifest(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-only")
	}
	node := filepath.Join(t.TempDir(), "node")
	if err := os.WriteFile(node, []byte("#!/bin/sh\nprintf '0.2.4\\n'\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := verifyVersionCommand(context.Background(), node, "/ignored/main.js", "0.2.4"); err != nil {
		t.Fatal(err)
	}
	if err := verifyVersionCommand(context.Background(), node, "/ignored/main.js", "0.2.5"); err == nil {
		t.Fatal("expected a version mismatch")
	}
}

func TestVersionComparison(t *testing.T) {
	for _, test := range []struct {
		got  string
		want bool
	}{
		{"0.2.3", false},
		{"0.2.4", true},
		{"0.2.5", true},
		{"0.10.0", true},
		{"1.0.0", true},
	} {
		if got := atLeast(test.got, "0.2.4"); got != test.want {
			t.Errorf("atLeast(%q) = %t, want %t", test.got, got, test.want)
		}
	}
}

func TestCandidatesStartBesideSelectedNode(t *testing.T) {
	home := t.TempDir()
	node := filepath.Join(home, ".hermes", "node", "bin", "node")
	paths := candidatePaths(home, node)
	want := filepath.Join(filepath.Dir(node), "pop")
	if runtime.GOOS == "windows" {
		want = filepath.Join(filepath.Dir(node), "node_modules", "pop-agent", "dist", "main.js")
	}
	if got := paths[0]; got != want {
		t.Fatalf("first candidate = %q, want %q", got, want)
	}
}
