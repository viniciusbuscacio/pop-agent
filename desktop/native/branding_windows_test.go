//go:build windows

package main

import (
	"os"
	"strings"
	"testing"
)

func TestWindowsTrayUsesUnifiedProductName(t *testing.T) {
	tray, err := os.ReadFile("internal/tray/tray_windows.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(tray)
	for _, label := range []string{`SetTooltip("Pop Desktop")`, `AddMenuItem("Pop Desktop"`, `AddMenuItem("Quit Pop Desktop"`} {
		if !strings.Contains(text, label) {
			t.Errorf("Windows tray is missing %q", label)
		}
	}
	if strings.Contains(text, "Pop Desktop Manager") {
		t.Fatal("Windows tray exposes the retired Manager name")
	}

	build, err := os.ReadFile("build-windows.ps1")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(build), "Pop Desktop Tray.exe") {
		t.Fatal("Windows build does not produce the tray helper")
	}
}
