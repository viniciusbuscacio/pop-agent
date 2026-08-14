//go:build darwin

package setupui

import (
	"runtime"
	"testing"
)

func TestDarwinSetupPasteMenuIsInstalled(t *testing.T) {
	runtime.LockOSThread()
	if !pasteMenuReadyForTesting() {
		t.Fatal("native Setup did not install the Command-V paste action")
	}
}
