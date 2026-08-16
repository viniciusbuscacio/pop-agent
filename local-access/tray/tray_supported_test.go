//go:build darwin || windows

package main

import "testing"

func TestStatusTitleHighlightsOnlyConnected(t *testing.T) {
	if got := statusTitle("Connected"); got != "🟢 Connected" {
		t.Fatalf("connected title = %q", got)
	}
	if got := statusTitle("Connecting"); got != "● Connecting" {
		t.Fatalf("connecting title = %q", got)
	}
}
