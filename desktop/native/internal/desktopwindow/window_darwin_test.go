//go:build darwin

package desktopwindow

import "testing"

func TestClosingLastWindowTerminatesDesktopAndTray(t *testing.T) {
	if !terminatesAfterLastWindowForTesting() {
		t.Fatal("closing Pop Desktop must terminate its internal Tray helper")
	}
}

func TestSessionBridgeAcceptsOnlyConfiguredMainFrame(t *testing.T) {
	server := "https://pop.example.com"
	if !sessionOriginAllowedForTesting(server, "https://pop.example.com/chat/1", true) {
		t.Fatal("configured main frame should be allowed to synchronize its session")
	}
	if sessionOriginAllowedForTesting(server, "https://attacker.invalid", true) {
		t.Fatal("external origin must not synchronize a session")
	}
	if sessionOriginAllowedForTesting(server, "https://pop.example.com/embedded", false) {
		t.Fatal("subframe must not synchronize a session")
	}
}

func TestNavigationDisposition(t *testing.T) {
	const (
		blocked  = 0
		internal = 1
		external = 2
	)
	server := "https://pop.example.com"
	tests := []struct {
		name string
		url  string
		want int
	}{
		{name: "same origin", url: "https://pop.example.com/chat/123?tab=files#top", want: internal},
		{name: "same origin explicit default port", url: "https://pop.example.com:443/settings", want: internal},
		{name: "different host", url: "https://example.com", want: external},
		{name: "different scheme", url: "http://pop.example.com", want: external},
		{name: "different port", url: "https://pop.example.com:8443", want: external},
		{name: "lookalike host", url: "https://pop.example.com.attacker.invalid", want: external},
		{name: "mailto handler", url: "mailto:hello@example.com", want: external},
		{name: "telephone handler", url: "tel:+15551234567", want: external},
		{name: "javascript blocked", url: "javascript:alert(1)", want: blocked},
		{name: "local file blocked", url: "file:///tmp/private", want: blocked},
		{name: "data blocked", url: "data:text/html,hello", want: blocked},
		{name: "unknown scheme blocked", url: "custom-app://open", want: blocked},
		{name: "invalid URL blocked", url: "://", want: blocked},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := navigationDispositionForTesting(server, test.url); got != test.want {
				t.Fatalf("navigationDispositionForTesting(%q, %q) = %d, want %d", server, test.url, got, test.want)
			}
		})
	}
}
