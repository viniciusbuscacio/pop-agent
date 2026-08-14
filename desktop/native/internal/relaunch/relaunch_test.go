package relaunch

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRunIfRequestedLeavesNormalStartupAlone(t *testing.T) {
	if handled, code := RunIfRequested(nil); handled || code != 0 {
		t.Fatalf("handled=%v code=%d", handled, code)
	}
}

func TestRunIfRequestedRejectsMalformedPrivateInvocation(t *testing.T) {
	for _, args := range [][]string{
		{helperFlag},
		{helperFlag, "/tmp/Other.app", "1", "2"},
		{helperFlag, "/tmp/Pop Desktop.app", "bad", "2"},
	} {
		if handled, code := RunIfRequested(args); !handled || code != 2 {
			t.Fatalf("args=%v handled=%v code=%d", args, handled, code)
		}
	}
}

func TestStartRejectsUnsafeRelaunchTarget(t *testing.T) {
	if err := Start(filepath.Join(t.TempDir(), "Other.app"), os.Getpid(), os.Getpid()); err == nil {
		t.Fatal("unsafe bundle name was accepted")
	}
}

func TestProcessAliveRecognizesCurrentProcess(t *testing.T) {
	if !processAlive(os.Getpid()) {
		t.Fatal("current process reported dead")
	}
}
