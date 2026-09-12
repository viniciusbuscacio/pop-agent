package main

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestRuntimeZip(t *testing.T) {
	for _, tc := range []struct {
		name    string
		entries []string
		ok      bool
	}{
		{"valid", []string{"node/node.exe", "node/node_modules/npm/bin/npm-cli.js"}, true},
		{"traversal", []string{"../escape"}, false},
		{"backslash traversal", []string{`..\escape`}, false},
		{"absolute", []string{"/root/node.exe"}, false},
		{"drive", []string{"C:/node.exe"}, false},
		{"multiple roots", []string{"one/node.exe", "two/file"}, false},
		{"duplicate", []string{"node/node.exe", "node/node.exe"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			archive := filepath.Join(dir, "node.zip")
			f, err := os.Create(archive)
			if err != nil {
				t.Fatal(err)
			}
			w := zip.NewWriter(f)
			for _, name := range tc.entries {
				entry, err := w.Create(name)
				if err != nil {
					t.Fatal(err)
				}
				entry.Write([]byte("runtime fixture"))
			}
			w.Close()
			f.Close()
			dest := filepath.Join(dir, "out")
			os.Mkdir(dest, 0700)
			err = extractNodeZip(archive, dest)
			if (err == nil) != tc.ok {
				t.Fatalf("success=%v err=%v", tc.ok, err)
			}
			if tc.ok {
				if _, err := os.Stat(filepath.Join(dest, "node.exe")); err != nil {
					t.Fatal(err)
				}
			}
		})
	}
}
