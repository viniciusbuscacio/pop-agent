package main

import "testing"

func TestComponentSelection(t *testing.T) {
	for _, c := range []Components{{true, true}, {true, false}, {false, true}} {
		if err := c.validate(); err != nil {
			t.Fatal(err)
		}
	}
	if (Components{}).validate() == nil {
		t.Fatal("empty selection accepted")
	}
	if got := (Components{CLI: true}).including(Components{Desktop: true}); !got.Desktop || !got.CLI {
		t.Fatal("upgrade removed Desktop")
	}
}
