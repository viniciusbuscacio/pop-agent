package desktopaccess

import (
	"context"
	"testing"
)

func TestClosedControllerIgnoresLateSession(t *testing.T) {
	controller := New(context.Background(), "https://pop.example.com")
	controller.Close()
	controller.SetSession("late-session")

	controller.mu.Lock()
	defer controller.mu.Unlock()
	if !controller.closed {
		t.Fatal("controller must remain closed")
	}
	if controller.token != "" {
		t.Fatalf("closed controller retained a late session: %q", controller.token)
	}
	if controller.starting {
		t.Fatal("closed controller started local access")
	}
}
