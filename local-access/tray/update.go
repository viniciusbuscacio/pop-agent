package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type installerUpdate struct {
	Version string `json:"version"`
	File    string `json:"file"`
	Size    int64  `json:"size"`
	SHA256  string `json:"sha256"`
}

var releaseVersion = regexp.MustCompile(`^\d+\.\d+\.\d+$`)
var releaseHash = regexp.MustCompile(`^[a-f0-9]{64}$`)

func newerVersion(candidate, current string) bool {
	if !releaseVersion.MatchString(candidate) || !releaseVersion.MatchString(current) {
		return false
	}
	a, b := strings.Split(candidate, "."), strings.Split(current, ".")
	for i := range a {
		x, e := strconv.ParseUint(a[i], 10, 32)
		y, f := strconv.ParseUint(b[i], 10, 32)
		if e != nil || f != nil {
			return false
		}
		if x != y {
			return x > y
		}
	}
	return false
}
func updateClient() *http.Client {
	return &http.Client{Timeout: 10 * time.Minute, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
func checkInstaller(ctx context.Context, server, platform, arch string) (*installerUpdate, error) {
	if !validLoginURL(server) {
		return nil, errors.New("Invalid server address")
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(server, "/")+"/local-access-update.json?platform="+platform+"&arch="+arch, nil)
	if err != nil {
		return nil, err
	}
	response, err := updateClient().Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == 404 {
		return nil, errors.New("No installer is published for this platform")
	}
	if response.StatusCode != 200 {
		return nil, errors.New("Update check unavailable")
	}
	var result installerUpdate
	if json.NewDecoder(io.LimitReader(response.Body, 16<<10)).Decode(&result) != nil {
		return nil, errors.New("Invalid update manifest")
	}
	suffix := ".dmg"
	if platform == "windows" {
		suffix = ".exe"
	}
	expected := "pop-local-access-" + result.Version + "-" + platform + "-" + arch + "-setup" + suffix
	if !releaseVersion.MatchString(result.Version) || result.File != expected || result.Size <= 0 || result.Size > 128<<20 || !releaseHash.MatchString(result.SHA256) {
		return nil, errors.New("Invalid installer metadata")
	}
	return &result, nil
}
func downloadInstaller(ctx context.Context, server, downloads string, update installerUpdate) (string, error) {
	if !validLoginURL(server) || filepath.Base(update.File) != update.File || strings.ContainsAny(update.File, "/\\") || update.Size <= 0 || update.Size > 128<<20 || !releaseHash.MatchString(update.SHA256) {
		return "", errors.New("Invalid download")
	}
	if err := os.MkdirAll(downloads, 0700); err != nil {
		return "", err
	}
	directory, err := os.MkdirTemp(downloads, "Pop-Local-Access-")
	if err != nil {
		return "", err
	}
	success := false
	defer func() {
		if !success {
			_ = os.RemoveAll(directory)
		}
	}()
	req, err := http.NewRequestWithContext(ctx, "GET", strings.TrimRight(server, "/")+"/local-access/"+update.File, nil)
	if err != nil {
		return "", err
	}
	response, err := updateClient().Do(req)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", errors.New("Installer download unavailable")
	}
	path := filepath.Join(directory, update.File)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	hash := sha256.New()
	size, err := io.Copy(io.MultiWriter(file, hash), io.LimitReader(response.Body, update.Size+1))
	closeErr := file.Close()
	if err != nil || closeErr != nil || size != update.Size || hex.EncodeToString(hash.Sum(nil)) != update.SHA256 {
		return "", errors.New("Installer verification failed")
	}
	success = true
	return path, nil
}
func (a *app) updateLoop() {
	a.checkUpdate()
	ticker := time.NewTicker(6 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-a.ctx.Done():
			return
		case <-ticker.C:
			a.checkUpdate()
		}
	}
}
func (a *app) checkUpdate() {
	a.mu.Lock()
	if a.updateBusy {
		a.mu.Unlock()
		return
	}
	a.updateBusy = true
	a.updateTitle = "Checking for updates…"
	a.mu.Unlock()
	a.publish()
	path, err := profilePath()
	var profile loginProfile
	if err == nil {
		_, profile, err = readProfiles(path)
	}
	var update *installerUpdate
	if err == nil {
		update, err = checkInstaller(a.ctx, profile.URL, runtime.GOOS, runtime.GOARCH)
	}
	a.mu.Lock()
	a.updateBusy = false
	a.availableUpdate = nil
	a.updateServer = ""
	if err != nil {
		a.updateTitle = "Check for updates…"
	} else if update != nil && newerVersion(update.Version, trayVersion) {
		a.availableUpdate = update
		a.updateServer = profile.URL
		a.updateTitle = "Update available…"
	} else {
		a.updateTitle = "Up to date — check again"
	}
	a.mu.Unlock()
	a.publish()
}
func (a *app) activateUpdate() {
	a.mu.Lock()
	if a.updateBusy {
		a.mu.Unlock()
		return
	}
	update := a.availableUpdate
	server := a.updateServer
	if update == nil {
		a.mu.Unlock()
		a.checkUpdate()
		return
	}
	a.updateBusy = true
	a.updateTitle = "Downloading update…"
	a.mu.Unlock()
	a.publish()
	home, err := os.UserHomeDir()
	var path string
	// Downloads contain only verified installers; installation remains an explicit native confirmation.
	if err == nil {
		path, err = downloadInstaller(a.ctx, server, filepath.Join(home, "Downloads"), *update)
	}
	if err == nil {
		err = openExternal(path)
	}
	a.mu.Lock()
	a.updateBusy = false
	if err != nil {
		a.updateTitle = "Update failed — retry"
	} else {
		a.updateTitle = fmt.Sprintf("Update %s downloaded", update.Version)
	}
	a.mu.Unlock()
	a.publish()
}
