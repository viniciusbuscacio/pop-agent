package tray

import (
	"os"
	"runtime"
	"strings"
	"testing"
)

func TestDesktopUpdateMenuItemsAreActuallyCreated(t *testing.T) {
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not locate tray source")
	}
	source, err := os.ReadFile(strings.TrimSuffix(file, "tray_source_test.go") + "tray_darwin.m")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, required := range []string{
		`popCheckDesktopItem = actionItem(@"Check Again", @selector(checkDesktop:));`,
		`popInstallDesktopItem = actionItem(@"Update Pop Desktop…", @selector(installDesktop:));`,
		`[desktopMenu addItem:popCheckDesktopItem];`,
		`[desktopMenu addItem:popInstallDesktopItem];`,
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("native tray does not create %q", required)
		}
	}
}
