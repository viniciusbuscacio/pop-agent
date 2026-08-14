//go:build windows

package tray

import (
	"bytes"
	"testing"
)

func TestWindowsMenuRequiresQuitCallback(t *testing.T) {
	if err := Install(Callbacks{}); err == nil {
		t.Fatal("Install accepted missing Quit callback")
	}
}

func TestWindowsStatusIconsRemainDistinct(t *testing.T) {
	var seen [][]byte
	for _, indicator := range []Indicator{IndicatorNeutral, IndicatorGood, IndicatorWarning, IndicatorBad} {
		icon := statusIcon(indicator)
		if len(icon) == 0 {
			t.Fatalf("empty status icon for %v", indicator)
		}
		for _, previous := range seen {
			if bytes.Equal(icon, previous) {
				t.Fatalf("duplicate icon for %v", indicator)
			}
		}
		seen = append(seen, icon)
	}
}
