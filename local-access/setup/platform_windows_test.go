//go:build windows

package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/sys/windows/registry"
)

func TestPreviewCannotInstallOrExposeCredentials(t *testing.T) {
	app := newSetup(true)
	if result := app.Install("https://fixture.test", "fixture-secret"); result == "" {
		t.Fatal("preview allowed installation")
	}
	if result := app.Uninstall(true); result == "" {
		t.Fatal("preview allowed uninstall")
	}
	state, _ := json.Marshal(app.GetState())
	if strings.Contains(string(state), "fixture-secret") {
		t.Fatal("password exposed in UI state")
	}
	app.state.Busy = true
	if !app.beforeClose(nil) {
		t.Fatal("allowed closing mid-transaction")
	}
	app.allowClose = true
	if app.beforeClose(nil) {
		t.Fatal("blocked completed installer exit")
	}
}

func TestPrivateProfileCanBeCreatedAndUpdated(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config", "profiles.json")
	for _, content := range []string{`{"default":{"token":"fixture-old"}}`, `{"default":{"token":"fixture-new"}}`} {
		if err := savePrivateProfile(path, []byte(content)); err != nil {
			t.Fatal(err)
		}
		actual, err := os.ReadFile(path)
		if err != nil || string(actual) != content {
			t.Fatal("profile write failed")
		}
	}
}

func TestRegistrationRollbackUsesIsolatedFixture(t *testing.T) {
	// Never touches the real Pop registration or the owner's startup entries.
	path := fmt.Sprintf(`Software\PopSetupFixture-%d`, time.Now().UnixNano())
	t.Cleanup(func() { _ = registry.DeleteKey(registry.CURRENT_USER, path) })
	fresh, err := snapshotRegistration(path)
	if err != nil {
		t.Fatal(err)
	}
	k, _, err := registry.CreateKey(registry.CURRENT_USER, path, registry.SET_VALUE)
	if err != nil {
		t.Fatal(err)
	}
	if err = k.SetStringValue("DisplayVersion", "old"); err != nil {
		t.Fatal(err)
	}
	_ = k.Close()
	old, err := snapshotRegistration(path)
	if err != nil {
		t.Fatal(err)
	}
	k, err = registry.OpenKey(registry.CURRENT_USER, path, registry.SET_VALUE)
	if err != nil {
		t.Fatal(err)
	}
	if err = k.SetStringValue("DisplayVersion", "new"); err != nil {
		t.Fatal(err)
	}
	if err = k.SetDWordValue("EstimatedSize", 123); err != nil {
		t.Fatal(err)
	}
	_ = k.Close()
	if err = old.restore(); err != nil {
		t.Fatal(err)
	}
	restored, err := snapshotRegistration(path)
	if err != nil || restored.strings["DisplayVersion"] != "old" || len(restored.numbers) != 0 {
		t.Fatal("upgrade registration was not restored")
	}
	if err = fresh.restore(); err != nil {
		t.Fatal(err)
	}
	restored, err = snapshotRegistration(path)
	if err != nil || restored.exists {
		t.Fatal("fresh registration was not removed")
	}
}
