//go:build windows

package desktop

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
)

const (
	BundleName       = "Pop Desktop.exe"
	BundleIdentifier = "com.popagent.desktop"
)

type Installation struct {
	Path      string
	Version   string
	Installed bool
	Err       error
}

func DefaultInstallPath() (string, error) {
	root := os.Getenv("LOCALAPPDATA")
	if root == "" {
		return "", errors.New("LOCALAPPDATA is unavailable")
	}
	return filepath.Join(root, "Programs", "Pop Desktop", BundleName), nil
}

func Detect(path string) Installation {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return Installation{Path: path}
	}
	if err != nil {
		return Installation{Path: path, Err: err}
	}
	if info.IsDir() {
		return Installation{Path: path, Err: errors.New("installed Desktop path is a directory")}
	}
	versionBytes, err := os.ReadFile(path + ".version")
	if err != nil {
		return Installation{Path: path, Err: errors.New("installed Desktop has no version metadata")}
	}
	return Installation{Path: path, Version: string(versionBytes), Installed: true}
}

func InstallPackage(string, string, string) error {
	return errors.New("Pop Desktop for Windows is not published yet")
}

func Open(path string) error {
	installation := Detect(path)
	if installation.Err != nil {
		return installation.Err
	}
	if !installation.Installed {
		return errors.New("Pop Desktop is not installed")
	}
	if err := exec.Command(path).Start(); err != nil {
		return fmt.Errorf("open Pop Desktop: %w", err)
	}
	return nil
}
