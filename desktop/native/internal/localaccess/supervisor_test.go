package localaccess

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSupervisorStartsWithStdinAndStopsProcessGroup(t *testing.T) {
	dir := t.TempDir()
	script := filepath.Join(dir, "managed.sh")
	body := "#!/bin/sh\nIFS= read -r config\nprintf '%s\\n' '{\"kind\":\"attached\",\"connectionId\":\"local-test\",\"transport\":\"wss\"}'\ntrap 'exit 0' TERM INT\nwhile :; do sleep 1; done\n"
	if err := os.WriteFile(script, []byte(body), 0o700); err != nil {
		t.Fatal(err)
	}
	events := make(chan Event, 2)
	supervisor := New(func(event Event) { events <- event })
	if err := supervisor.Start(context.Background(), Config{
		NodePath: "/bin/sh", EntryPath: script, ServerURL: "https://pop.example", Token: "secret",
	}); err != nil {
		t.Fatal(err)
	}
	select {
	case event := <-events:
		if event.ConnectionID != "local-test" {
			t.Fatalf("unexpected event: %#v", event)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("managed process did not attach")
	}
	if !supervisor.Running() {
		t.Fatal("expected process to be running")
	}
	if err := supervisor.UpdateToken("renewed"); err != nil {
		t.Fatalf("update session token: %v", err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	supervisor.mu.Lock()
	childDir := supervisor.cmd.Dir
	supervisor.mu.Unlock()
	if childDir != home {
		t.Fatalf("child working directory = %q, want %q", childDir, home)
	}
	supervisor.Stop(2 * time.Second)
	if supervisor.Running() {
		t.Fatal("expected process to stop")
	}
}

func TestSupervisorRejectsIncompleteConfig(t *testing.T) {
	if err := New(nil).Start(context.Background(), Config{}); err == nil {
		t.Fatal("expected incomplete config to fail")
	}
}
