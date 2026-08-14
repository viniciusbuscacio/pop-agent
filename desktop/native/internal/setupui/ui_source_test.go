package setupui

import (
	"os"
	"strings"
	"testing"
)

func TestDarwinSetupInstallsStandardEditCommands(t *testing.T) {
	source, err := os.ReadFile("ui_darwin.m")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, command := range []string{
		"installMenus();",
		"@selector(cut:)",
		"@selector(copy:)",
		"@selector(paste:)",
		"@selector(selectAll:)",
	} {
		if !strings.Contains(text, command) {
			t.Fatalf("native Setup is missing %s", command)
		}
	}
}
