package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestChildDiagnosticsKeepTimestampAttemptAndExitContext(t *testing.T) {
	var out strings.Builder
	d := &childDiagnostics{out: &out, attempt: 4}
	_, _ = d.Write([]byte("GET https://user:password@pop.example/cli/manifest.json?token=hidden: HTTP 404. "))
	_, _ = d.Write([]byte("distribuição indisponível\nRun pop doctor\npartial"))
	tail := d.finish()
	if !strings.Contains(tail, "HTTP 404") || !strings.Contains(tail, "distribuição") || !strings.Contains(tail, "partial") {
		t.Fatal(tail)
	}
	for _, secret := range []string{"password", "hidden", "user:"} {
		if strings.Contains(out.String(), secret) {
			t.Fatalf("secret logged: %s", out.String())
		}
	}
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatal(err)
		}
		if entry["event"] != "child_stderr" || entry["attempt"] != float64(4) {
			t.Fatal(entry)
		}
		if _, err := time.Parse(time.RFC3339Nano, entry["time"].(string)); err != nil {
			t.Fatal(err)
		}
	}
}
func TestDiagnosticSecretsAndBounds(t *testing.T) {
	got := sanitizeDiagnostic(`Authorization: Bearer abc123 token=tok123 password="pass123" https://user:pass@pop.example/path?key=url123#fragment`)
	for _, secret := range []string{"abc123", "tok123", "pass123", "url123", "fragment", "user:pass"} {
		if strings.Contains(got, secret) {
			t.Fatalf("secret retained: %s", got)
		}
	}
	var out strings.Builder
	d := &childDiagnostics{out: &out, attempt: 1}
	_, _ = d.Write([]byte(strings.Repeat("x", 100000) + "\nfirst\nsecond\nthird\nfourth\n"))
	if len(out.String()) > 4096 || len(d.pending) != 0 {
		t.Fatal("unbounded diagnostics")
	}
	if tail := d.finish(); strings.Contains(tail, "first") || !strings.Contains(tail, "fourth") {
		t.Fatal(tail)
	}
}
