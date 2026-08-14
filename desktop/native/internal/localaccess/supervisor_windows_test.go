//go:build windows

package localaccess

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestWindowsSupervisorStartsAndStopsNodeProcess(t *testing.T) {
	node, err := exec.LookPath("node.exe")
	if err != nil {
		t.Skip("Node is not installed")
	}
	script := filepath.Join(t.TempDir(), "managed.mjs")
	body := `process.stdin.once('data', () => {
  process.stdout.write(JSON.stringify({kind:'attached',connectionId:'local-test',transport:'wss'})+'\n');
});
process.stdin.resume();
process.stdin.on('end', () => process.exit(0));
setInterval(() => {}, 1000);
`
	if err := os.WriteFile(script, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	events := make(chan Event, 1)
	supervisor := New(func(event Event) { events <- event })
	if err := supervisor.Start(context.Background(), Config{
		NodePath: node, EntryPath: script, ServerURL: "https://pop.example", Token: "secret",
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-events:
		if event.ConnectionID != "local-test" {
			t.Fatalf("unexpected event: %#v", event)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("managed process did not attach")
	}
	started := time.Now()
	supervisor.Stop(3 * time.Second)
	if elapsed := time.Since(started); elapsed > 1500*time.Millisecond {
		t.Fatalf("graceful stop took %s", elapsed)
	}
	if supervisor.Running() {
		t.Fatal("expected managed process to stop")
	}
}
