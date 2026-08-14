package desktopwindow

import "testing"

func TestNavigationPolicy(t *testing.T) {
	const server = "https://pop.example"
	for _, test := range []struct {
		name      string
		candidate string
		want      navigationDisposition
	}{
		{"same origin", "https://pop.example/chat/1", navigationInternal},
		{"same origin default port", "https://pop.example:443/settings", navigationInternal},
		{"different port", "https://pop.example:444/chat", navigationExternal},
		{"external https", "https://example.com/help", navigationExternal},
		{"external http", "http://example.com/help", navigationExternal},
		{"mail", "mailto:hello@example.com", navigationExternal},
		{"phone", "tel:+5511999999999", navigationExternal},
		{"file", "file:///C:/secret.txt", navigationBlocked},
		{"data", "data:text/html,hello", navigationBlocked},
		{"javascript", "javascript:alert(1)", navigationBlocked},
		{"unknown", "custom:payload", navigationBlocked},
		{"invalid", "://bad", navigationBlocked},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := navigationPolicy(server, test.candidate); got != test.want {
				t.Fatalf("navigationPolicy(%q, %q) = %v, want %v", server, test.candidate, got, test.want)
			}
		})
	}
}
