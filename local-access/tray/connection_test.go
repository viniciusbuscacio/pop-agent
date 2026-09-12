package main

import (
	"os/exec"
	"strings"
	"testing"
)

func TestConnectionIndependentOfPermission(t *testing.T) {
	cmd := &exec.Cmd{}
	a := &app{command: cmd}
	for _, step := range []struct {
		event            string
		connected, known bool
	}{
		{`{"kind":"starting"}`, false, false},
		{`{"kind":"attached"}`, true, false},
		{`{"kind":"access-policy","enabled":false}`, true, true},
		{`{"kind":"closed"}`, false, false},
		{`{"kind":"attached"}`, true, false},
		{`{"kind":"authentication-required"}`, false, false},
		{`{"kind":"attached"}`, true, false},
		{`{"kind":"outdated"}`, false, false},
	} {
		a.scan(strings.NewReader(step.event+"\n"), cmd)
		if a.connected != step.connected || a.accessKnown != step.known {
			t.Fatalf("after %s: connected=%v known=%v", step.event, a.connected, a.accessKnown)
		}
	}
	a.connected = true
	a.accessKnown = true
	a.command = nil
	a.stop()
	if a.connected || a.accessKnown {
		t.Fatal("stop retained live connection state")
	}
}
