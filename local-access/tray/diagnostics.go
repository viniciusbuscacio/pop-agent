package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"
)

var diagnosticURL = regexp.MustCompile(`https?://[^\s"'<>]+`)
var diagnosticSecret = regexp.MustCompile(`(?i)((?:token|password|secret|api[_-]?key)["']?\s*[:=]\s*["']?)[^\s,;"']+`)
var diagnosticBearer = regexp.MustCompile(`(?i)((?:bearer|basic)\s+)[^\s,;"']+`)

func sanitizeDiagnostic(value string) string {
	value = diagnosticURL.ReplaceAllStringFunc(value, func(raw string) string {
		parsed, err := url.Parse(raw)
		if err != nil {
			return "[redacted URL]"
		}
		return parsed.Scheme + "://" + parsed.Host + parsed.EscapedPath()
	})
	value = diagnosticSecret.ReplaceAllString(value, "${1}[REDACTED]")
	value = diagnosticBearer.ReplaceAllString(value, "${1}[REDACTED]")
	if len(value) > 2048 {
		value = value[:2048] + " [truncated]"
	}
	return strings.TrimSpace(value)
}
func writeDiagnostic(out io.Writer, event string, fields map[string]any) {
	if out == nil {
		return
	}
	entry := map[string]any{"time": time.Now().UTC().Format(time.RFC3339Nano), "component": "local-access", "version": trayVersion, "event": event}
	for key, value := range fields {
		entry[key] = value
	}
	data, err := json.Marshal(entry)
	if err == nil {
		_, _ = fmt.Fprintln(out, string(data))
	}
}

// Stderr can arrive in arbitrary chunks. Keep bounded lines and a short exit context.
type childDiagnostics struct {
	mu         sync.Mutex
	out        io.Writer
	attempt    int
	pending    []byte
	tail       []string
	discarding bool
}

func (d *childDiagnostics) line(value string) {
	value = sanitizeDiagnostic(value)
	if value == "" {
		return
	}
	writeDiagnostic(d.out, "child_stderr", map[string]any{"attempt": d.attempt, "message": value})
	d.tail = append(d.tail, value)
	if len(d.tail) > 3 {
		d.tail = d.tail[len(d.tail)-3:]
	}
}
func (d *childDiagnostics) Write(data []byte) (int, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	for _, b := range data {
		if b == '\n' {
			if !d.discarding {
				d.line(string(d.pending))
			}
			d.pending = nil
			d.discarding = false
		} else if !d.discarding {
			d.pending = append(d.pending, b)
			if len(d.pending) >= 8192 {
				d.line("[oversized stderr line omitted]")
				d.pending = nil
				d.discarding = true
			}
		}
	}
	return len(data), nil
}
func (d *childDiagnostics) finish() string {
	d.mu.Lock()
	defer d.mu.Unlock()
	if len(d.pending) != 0 {
		d.line(string(d.pending))
		d.pending = nil
	}
	return strings.Join(d.tail, " | ")
}
