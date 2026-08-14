//go:build !windows

package desktop

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"
)

func TestDetectReadsManagedBundle(t *testing.T) {
	withoutSignatureVerification(t)
	bundle := filepath.Join(t.TempDir(), BundleName)
	macOS := filepath.Join(bundle, "Contents", "MacOS")
	if err := os.MkdirAll(macOS, 0o755); err != nil {
		t.Fatal(err)
	}
	plist := `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>com.popagent.desktop</string><key>CFBundleExecutable</key><string>Pop Desktop</string><key>CFBundleShortVersionString</key><string>0.2.6</string></dict></plist>`
	if err := os.WriteFile(filepath.Join(bundle, "Contents", "Info.plist"), []byte(plist), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(macOS, "Pop Desktop"), []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	got := Detect(bundle)
	if !got.Installed || got.Version != "0.2.6" || got.Err != nil {
		t.Fatalf("installation = %+v", got)
	}
}

func TestDetectRejectsAnotherBundle(t *testing.T) {
	withoutSignatureVerification(t)
	bundle := filepath.Join(t.TempDir(), BundleName)
	if err := os.MkdirAll(filepath.Join(bundle, "Contents"), 0o755); err != nil {
		t.Fatal(err)
	}
	plist := `<?xml version="1.0"?><plist><dict><key>CFBundleIdentifier</key><string>example.other</string></dict></plist>`
	if err := os.WriteFile(filepath.Join(bundle, "Contents", "Info.plist"), []byte(plist), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := Detect(bundle); got.Installed || got.Err == nil {
		t.Fatalf("installation = %+v", got)
	}
}

func withoutSignatureVerification(t *testing.T) {
	t.Helper()
	previous := signatureVerifier
	signatureVerifier = func(string) error { return nil }
	t.Cleanup(func() { signatureVerifier = previous })
}

func TestExtractRejectsTraversalAndSymlinks(t *testing.T) {
	for name, mode := range map[string]os.FileMode{"../outside": 0o644, "Pop Desktop.app/link": os.ModeSymlink | 0o777} {
		archivePath := filepath.Join(t.TempDir(), "bad.zip")
		file, err := os.Create(archivePath)
		if err != nil {
			t.Fatal(err)
		}
		writer := zip.NewWriter(file)
		header := &zip.FileHeader{Name: name, Method: zip.Store}
		header.SetMode(mode)
		entry, err := writer.CreateHeader(header)
		if err != nil {
			t.Fatal(err)
		}
		_, _ = entry.Write([]byte("bad"))
		_ = writer.Close()
		_ = file.Close()
		if err := extract(archivePath, t.TempDir()); err == nil {
			t.Fatalf("extract accepted %q", name)
		}
	}
}
