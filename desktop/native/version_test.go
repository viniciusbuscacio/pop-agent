package main

import (
	"encoding/xml"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestProductVersionsStayAligned(t *testing.T) {
	versionBytes, err := os.ReadFile("VERSION")
	if err != nil {
		t.Fatal(err)
	}
	version := strings.TrimSpace(string(versionBytes))
	if version == "" {
		t.Fatal("VERSION is empty")
	}
	for _, path := range []string{"build/desktop/Info.plist"} {
		values, err := plistStrings(path)
		if err != nil {
			t.Fatal(err)
		}
		for _, key := range []string{"CFBundleVersion", "CFBundleShortVersionString"} {
			if values[key] != version {
				t.Errorf("%s %s = %q, want %q", path, key, values[key], version)
			}
		}
	}
}

func TestGlobalVersionCheck(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX version gate is covered by build-windows.ps1 on Windows")
	}
	local, err := os.ReadFile("VERSION")
	if err != nil {
		t.Fatal(err)
	}
	central := filepath.Join(t.TempDir(), "VERSION")
	if err := os.WriteFile(central, local, 0o600); err != nil {
		t.Fatal(err)
	}
	command := exec.Command("./check-global-version.sh")
	command.Env = append(os.Environ(), "POP_AGENT_VERSION_FILE="+central)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("matching global version failed: %v\n%s", err, output)
	}

	if err := os.WriteFile(central, []byte("0.2.11\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	command = exec.Command("./check-global-version.sh")
	command.Env = append(os.Environ(), "POP_AGENT_VERSION_FILE="+central)
	output, err := command.CombinedOutput()
	if err == nil || !strings.Contains(string(output), "does not match global Pop Agent version") {
		t.Fatalf("mismatch was not rejected: err=%v output=%s", err, output)
	}
}

func plistStrings(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	decoder := xml.NewDecoder(file)
	values := map[string]string{}
	var key string
	for {
		token, err := decoder.Token()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return values, nil
			}
			return nil, err
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		switch start.Name.Local {
		case "key":
			if err := decoder.DecodeElement(&key, &start); err != nil {
				return nil, err
			}
		case "string":
			var value string
			if err := decoder.DecodeElement(&value, &start); err != nil {
				return nil, err
			}
			if key != "" {
				values[key] = value
				key = ""
			}
		}
	}
}
