package main

import (
	"os"
	"strings"
	"testing"
)

func TestNormalUserFacingBrandingUsesPopDesktop(t *testing.T) {
	traySource, err := os.ReadFile("internal/tray/tray_darwin.m")
	if err != nil {
		t.Fatal(err)
	}
	trayText := string(traySource)
	for _, label := range []string{
		`setToolTip:@"Pop Desktop"`,
		`initWithTitle:@"Pop Desktop"`,
		`headerItem(@"Pop Desktop")`,
		`initWithTitle:@"Quit Pop Desktop"`,
	} {
		if !strings.Contains(trayText, label) {
			t.Errorf("tray is missing public product label %q", label)
		}
	}
	for _, label := range []string{
		`setToolTip:@"Pop Desktop Tray"`,
		`initWithTitle:@"Quit Pop Desktop Tray"`,
	} {
		if strings.Contains(trayText, label) {
			t.Errorf("tray exposes technical helper name in normal UI: %q", label)
		}
	}

	appSource, err := os.ReadFile("app.go")
	if err != nil {
		t.Fatal(err)
	}
	appText := string(appSource)
	for _, label := range []string{
		`Pop Desktop Tray is connected`,
		`Pop Desktop Tray Diagnostics`,
		`manager configuration path`,
	} {
		if strings.Contains(appText, label) {
			t.Errorf("app exposes a legacy or technical product name: %q", label)
		}
	}
}
