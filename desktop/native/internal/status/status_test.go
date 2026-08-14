package status

import "testing"

func TestInitialSnapshot(t *testing.T) {
	got := Initial()
	if got.Server.State != NotConfigured || got.Desktop.State != NotInstalled {
		t.Fatalf("unexpected install states: %+v", got)
	}
	if got.CLI.State != Checking || got.Node.State != Checking {
		t.Fatalf("unexpected runtime states: %+v", got)
	}
}
