//go:build !windows

package desktop

import (
	"archive/zip"
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

var signatureVerifier = verifySignature

const (
	BundleName       = "Pop Desktop.app"
	BundleIdentifier = "com.popagent.desktop"
	maxExpandedBytes = 128 << 20
)

type Installation struct {
	Path      string
	Version   string
	Installed bool
	Err       error
}

type plistMap map[string]string

func DefaultInstallPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("locate home directory: %w", err)
	}
	return filepath.Join(home, "Applications", BundleName), nil
}

func Detect(path string) Installation {
	bundleStat, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return Installation{Path: path}
	}
	if err != nil {
		return Installation{Path: path, Err: err}
	}
	if !bundleStat.IsDir() || bundleStat.Mode()&os.ModeSymlink != 0 {
		return Installation{Path: path, Err: errors.New("installed bundle path is not a directory")}
	}
	info, err := readBundleInfo(path)
	if err != nil {
		return Installation{Path: path, Err: err}
	}
	if info["CFBundleIdentifier"] != BundleIdentifier || info["CFBundleExecutable"] != "Pop Desktop" || info["CFBundleShortVersionString"] == "" {
		return Installation{Path: path, Err: errors.New("installed bundle has invalid metadata")}
	}
	executable := filepath.Join(path, "Contents", "MacOS", info["CFBundleExecutable"])
	stat, err := os.Stat(executable)
	if err != nil || stat.IsDir() || stat.Mode()&0o111 == 0 {
		return Installation{Path: path, Err: errors.New("installed bundle has no executable")}
	}
	if err := signatureVerifier(path); err != nil {
		return Installation{Path: path, Err: err}
	}
	return Installation{Path: path, Version: info["CFBundleShortVersionString"], Installed: true}
}

func InstallPackage(packagePath, destination, expectedVersion string) error {
	parent := filepath.Dir(destination)
	if err := os.MkdirAll(parent, 0o755); err != nil {
		return fmt.Errorf("create Applications directory: %w", err)
	}
	stage, err := os.MkdirTemp(parent, ".pop-desktop-install-*")
	if err != nil {
		return fmt.Errorf("create install staging directory: %w", err)
	}
	defer os.RemoveAll(stage)

	if err := extract(packagePath, stage); err != nil {
		return err
	}
	bundle := filepath.Join(stage, BundleName)
	installation := Detect(bundle)
	if installation.Err != nil {
		return fmt.Errorf("validate Pop Desktop package: %w", installation.Err)
	}
	if !installation.Installed {
		return errors.New("validate Pop Desktop package: bundle is missing")
	}
	if installation.Version != expectedVersion {
		return fmt.Errorf("package version is %s, expected %s", installation.Version, expectedVersion)
	}
	backup, err := os.MkdirTemp(parent, ".pop-desktop-previous-*")
	if err != nil {
		return fmt.Errorf("create rollback path: %w", err)
	}
	if err := os.Remove(backup); err != nil {
		return fmt.Errorf("prepare rollback path: %w", err)
	}
	hadPrevious := false
	if _, err := os.Lstat(destination); err == nil {
		if err := os.Rename(destination, backup); err != nil {
			return fmt.Errorf("prepare existing Pop Desktop: %w", err)
		}
		hadPrevious = true
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect existing Pop Desktop: %w", err)
	}
	if err := os.Rename(bundle, destination); err != nil {
		if hadPrevious {
			_ = os.Rename(backup, destination)
		}
		return fmt.Errorf("activate Pop Desktop: %w", err)
	}
	if hadPrevious {
		_ = os.RemoveAll(backup)
	}
	return nil
}

func Open(path string) error {
	installation := Detect(path)
	if installation.Err != nil {
		return installation.Err
	}
	if !installation.Installed {
		return errors.New("Pop Desktop is not installed")
	}
	if err := exec.Command("/usr/bin/open", path).Run(); err != nil {
		return fmt.Errorf("open Pop Desktop: %w", err)
	}
	return nil
}

func extract(packagePath, destination string) error {
	archive, err := zip.OpenReader(packagePath)
	if err != nil {
		return fmt.Errorf("open Pop Desktop package: %w", err)
	}
	defer archive.Close()
	var declared uint64
	var expanded int64
	for _, entry := range archive.File {
		normalized := strings.TrimSuffix(entry.Name, "/")
		clean := filepath.Clean(normalized)
		if clean != normalized || clean == "." || filepath.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, ".."+string(os.PathSeparator)) {
			return errors.New("Pop Desktop package contains an unsafe path")
		}
		if entry.Mode()&os.ModeSymlink != 0 || (!entry.FileInfo().IsDir() && !entry.Mode().IsRegular()) {
			return errors.New("Pop Desktop package contains an unsupported entry")
		}
		declared += entry.UncompressedSize64
		if declared > maxExpandedBytes {
			return errors.New("Pop Desktop package is too large")
		}
		target := filepath.Join(destination, clean)
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, entry.Mode().Perm()); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		reader, err := entry.Open()
		if err != nil {
			return err
		}
		file, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, entry.Mode().Perm())
		if err == nil {
			var written int64
			written, err = io.Copy(file, io.LimitReader(reader, maxExpandedBytes-expanded+1))
			expanded += written
			if err == nil && expanded > maxExpandedBytes {
				err = errors.New("Pop Desktop package is too large")
			}
			if closeErr := file.Close(); err == nil {
				err = closeErr
			}
		}
		reader.Close()
		if err != nil {
			return fmt.Errorf("extract Pop Desktop package: %w", err)
		}
	}
	return nil
}

func verifySignature(bundle string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, "/usr/bin/codesign", "--verify", "--deep", "--strict", bundle).CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if message == "" {
			message = err.Error()
		}
		return fmt.Errorf("verify Pop Desktop signature: %s", message)
	}
	return nil
}

func readBundleInfo(bundle string) (plistMap, error) {
	file, err := os.Open(filepath.Join(bundle, "Contents", "Info.plist"))
	if err != nil {
		return nil, err
	}
	defer file.Close()
	decoder := xml.NewDecoder(io.LimitReader(file, 1<<20))
	result := plistMap{}
	var pendingKey string
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("decode Info.plist: %w", err)
		}
		start, ok := token.(xml.StartElement)
		if !ok {
			continue
		}
		switch start.Name.Local {
		case "key":
			if err := decoder.DecodeElement(&pendingKey, &start); err != nil {
				return nil, err
			}
		case "string":
			var value string
			if err := decoder.DecodeElement(&value, &start); err != nil {
				return nil, err
			}
			if pendingKey != "" {
				result[pendingKey] = value
				pendingKey = ""
			}
		}
	}
	return result, nil
}
