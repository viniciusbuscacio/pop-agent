package main

import "testing"

func TestDesktopNavigation(t *testing.T) {
	for _, test := range []struct {
		target             string
		internal, external bool
	}{
		{"https://pop.test/chat/1", true, false},
		{"https://POP.test:443/settings", true, false},
		{"https://other.test/", false, true},
		{"https://pop.test:444/", false, true},
		{"https://pop.test.evil.test/", false, true},
		{"https://secret@pop.test/", false, false},
		{"file:///C:/secret", false, false},
		{"javascript:alert(1)", false, false},
		{"http://pop.test/", false, false},
		{"ms-settings:privacy", false, false},
	} {
		i, e := desktopNavigation("https://pop.test", test.target)
		if i != test.internal || e != test.external {
			t.Errorf("%s: got %v %v", test.target, i, e)
		}
	}
}
