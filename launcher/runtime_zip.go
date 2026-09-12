package main

import (
	"archive/zip"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func extractNodeZip(archive, destination string) error {
	reader, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer reader.Close()
	if len(reader.File) == 0 || len(reader.File) > maximumRuntimeFiles {
		return errors.New("invalid runtime archive entry count")
	}
	var root string
	var expanded uint64
	for _, entry := range reader.File {
		name := strings.ReplaceAll(entry.Name, "\\", "/")
		clean := path.Clean(name)
		if strings.Contains(clean, ":") || strings.HasPrefix(clean, "/") || clean == ".." || strings.HasPrefix(clean, "../") {
			return fmt.Errorf("unsafe runtime ZIP path %q", entry.Name)
		}
		parts := strings.Split(clean, "/")
		if root == "" {
			root = parts[0]
		}
		if root == "." || parts[0] != root {
			return errors.New("runtime ZIP has invalid or multiple roots")
		}
		if len(parts) == 1 {
			if !entry.FileInfo().IsDir() {
				return errors.New("runtime ZIP root is not a directory")
			}
			continue
		}
		relative := filepath.FromSlash(strings.Join(parts[1:], "/"))
		if !filepath.IsLocal(relative) {
			return errors.New("runtime ZIP has an unsafe local filename")
		}
		target := filepath.Join(destination, relative)
		if !withinDirectory(destination, target) {
			return errors.New("runtime ZIP escapes staging")
		}
		if entry.Mode()&os.ModeSymlink != 0 {
			return errors.New("runtime ZIP contains symlink")
		}
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if !entry.Mode().IsRegular() {
			return errors.New("runtime ZIP contains special file")
		}
		if entry.UncompressedSize64 > uint64(maximumRuntimeExpansion)-expanded {
			return errors.New("runtime ZIP exceeds expanded size limit")
		}
		expanded += entry.UncompressedSize64
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		input, err := entry.Open()
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0644)
		if err != nil {
			input.Close()
			return err
		}
		n, copyErr := io.Copy(output, io.LimitReader(input, int64(entry.UncompressedSize64)+1))
		input.Close()
		closeErr := output.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if uint64(n) != entry.UncompressedSize64 {
			return errors.New("runtime ZIP entry size mismatch")
		}
	}
	return nil
}
