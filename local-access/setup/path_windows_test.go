//go:build windows

package main

import (
	"golang.org/x/sys/windows/registry"
	"testing"
)

func TestComponentPathPreservesOtherEntries(t *testing.T) {
	original := pathSnapshot{`%USERPROFILE%\bin;C:\Tools`, registry.EXPAND_SZ, true}
	directory := `C:\Users\Owner\AppData\Local\PopAgent\LocalAccess\cli`
	added := componentPath(original, directory, true)
	if added.value != original.value+";"+directory || added.kind != original.kind {
		t.Fatal("unrelated PATH changed")
	}
	if again := componentPath(added, directory, true); again != added {
		t.Fatal("duplicate PATH entry")
	}
	if removed := componentPath(added, directory, false); removed != original {
		t.Fatal("removal did not preserve other entries")
	}
	quoted := pathSnapshot{`C:\Tools;"` + directory + `"`, registry.SZ, true}
	if got := componentPath(quoted, directory, false); got.value != `C:\Tools` || got.kind != registry.SZ {
		t.Fatal("quoted entry not removed safely")
	}
}

func TestEmptySelectionRejectedBeforeInitialization(t *testing.T) {
	a := newSetup(true)
	if !a.GetState().Components.Desktop || !a.GetState().Components.CLI {
		t.Fatal("both components must default on")
	}
	if result := a.Install("https://fixture.test", "", false, false); result != "Select Pop Agent Desktop, Pop Agent CLI, or both." {
		t.Fatal(result)
	}
	if a.GetState().Busy || a.GetState().Done {
		t.Fatal("invalid selection mutated setup state")
	}
}
