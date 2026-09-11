//go:build windows

package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

func validateCleanupManifest(path, expected string) bool {
	self, err := os.Executable()
	if err != nil {
		return false
	}
	dir := filepath.Dir(path)
	if !strings.EqualFold(filepath.Dir(self), dir) || !strings.EqualFold(filepath.Dir(dir), filepath.Clean(os.TempDir())) || !strings.HasPrefix(filepath.Base(dir), setupID+"-uninstall-") {
		return false
	}
	data, err := readBoundedFile(path, 64<<10)
	if err != nil || len(data) > 64<<10 {
		return false
	}
	var m struct {
		InstallDir  string   `json:"installDir"`
		DataDirs    []string `json:"dataDirs"`
		Shortcuts   []string `json:"shortcuts"`
		RegistryKey string   `json:"registryKey"`
		ParentPID   int      `json:"parentPid"`
	}
	if json.Unmarshal(data, &m) != nil || !strings.EqualFold(filepath.Clean(m.InstallDir), expected) || len(m.DataDirs) != 0 || m.ParentPID <= 0 || m.RegistryKey != `Software\Microsoft\Windows\CurrentVersion\Uninstall\`+setupID {
		return false
	}
	allowed := map[string]bool{}
	for _, id := range []*windows.KNOWNFOLDERID{windows.FOLDERID_Programs, windows.FOLDERID_Desktop} {
		root, err := windows.KnownFolderPath(id, 0)
		if err != nil {
			return false
		}
		allowed[strings.ToLower(filepath.Join(root, "Pop Agent.lnk"))] = true
	}
	for _, path := range m.Shortcuts {
		if !allowed[strings.ToLower(filepath.Clean(path))] {
			return false
		}
	}
	return checkInstallDirectory(expected) == nil
}
