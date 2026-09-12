//go:build darwin

package main

/*
#include <stdlib.h>
void popDesktopUpdateStatus(const char*);
void popDesktopQuitForUpdate(void);
*/
import "C"
import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"syscall"
	"time"
	"unsafe"
)

var desktopUpdating atomic.Bool

type desktopUpdateState struct {
	PID      int    `json:"pid"`
	StartURL string `json:"startUrl"`
	Version  string `json:"version"`
}

func desktopUpdateStatus(status string) {
	text := C.CString(status)
	defer C.free(unsafe.Pointer(text))
	C.popDesktopUpdateStatus(text)
}

//export popDesktopBeginUpdate
func popDesktopBeginUpdate(raw *C.char) {
	startURL := C.GoString(raw)
	if !desktopUpdating.CompareAndSwap(false, true) {
		return
	}
	go func() {
		defer desktopUpdating.Store(false)
		directory, err := prepareDesktopUpdate(context.Background(), startURL)
		if err != nil {
			desktopUpdateStatus("error")
			return
		}
		if directory == "" {
			desktopUpdateStatus("current")
			return
		}
		helper := exec.Command(filepath.Join(directory, "helper"), "--apply-desktop-update", directory)
		helper.Stdin = nil
		helper.Stdout = nil
		helper.Stderr = nil
		if err = helper.Start(); err != nil {
			_ = os.RemoveAll(directory)
			desktopUpdateStatus("error")
			return
		}
		_ = helper.Process.Release()
		desktopUpdateStatus("restarting")
		C.popDesktopQuitForUpdate()
	}()
}

func prepareDesktopUpdate(ctx context.Context, startURL string) (directory string, err error) {
	profileFile, err := profilePath()
	if err != nil {
		return "", err
	}
	_, profile, err := readProfiles(profileFile)
	if err != nil {
		return "", err
	}
	server := safeOrigin(profile.URL)
	parsed, e := url.Parse(startURL)
	if e != nil || safeOrigin(startURL) != server || parsed.User != nil {
		return "", errors.New("Invalid update origin")
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Minute)
	defer cancel()
	checkCtx, checkCancel := context.WithTimeout(ctx, 15*time.Second)
	defer checkCancel()
	req, err := http.NewRequestWithContext(checkCtx, "GET", server+"/desktop-update.json?platform=darwin&arch="+runtime.GOARCH, nil)
	if err != nil {
		return "", err
	}
	response, err := updateClient().Do(req)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return "", errors.New("Desktop update unavailable")
	}
	var update installerUpdate
	if json.NewDecoder(io.LimitReader(response.Body, 16<<10)).Decode(&update) != nil {
		return "", errors.New("Invalid desktop update")
	}
	if !releaseVersion.MatchString(update.Version) || update.File != "pop-local-access-"+update.Version+"-darwin-"+runtime.GOARCH || !releaseHash.MatchString(update.SHA256) || update.Size <= 0 || update.Size > 128<<20 {
		return "", errors.New("Invalid desktop update metadata")
	}
	if !newerVersion(update.Version, trayVersion) {
		return "", nil
	}
	desktopUpdateStatus("downloading")
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	root := filepath.Join(home, ".local", "share", "pop-agent", "desktop-updates")
	if err = os.MkdirAll(root, 0700); err != nil {
		return "", err
	}
	directory, err = os.MkdirTemp(root, "update-")
	if err != nil {
		return "", err
	}
	success := false
	cleanupDirectory := directory
	defer func() {
		if !success {
			_ = os.RemoveAll(cleanupDirectory)
		}
	}()
	payload, err := downloadInstaller(ctx, server, directory, update)
	if err != nil {
		return "", err
	}
	if err = os.Chmod(payload, 0700); err != nil {
		return "", err
	}
	if err = exec.Command("/usr/bin/codesign", "--verify", "--strict", payload).Run(); err != nil {
		return "", err
	}
	candidate := filepath.Join(directory, "Pop Agent Desktop.app")
	if err = exec.Command("/usr/bin/ditto", desktopBundle(), candidate).Run(); err != nil {
		return "", err
	}
	target := filepath.Join(candidate, "Contents", "MacOS", "Pop Agent Desktop")
	if err = copyDesktopFile(payload, target, 0700); err != nil {
		return "", err
	}
	if err = exec.Command("/usr/libexec/PlistBuddy", "-c", "Set :CFBundleShortVersionString "+update.Version, filepath.Join(candidate, "Contents", "Info.plist")).Run(); err != nil {
		return "", err
	}
	if err = exec.Command("/usr/bin/codesign", "--force", "--sign", "-", candidate).Run(); err != nil {
		return "", err
	}
	if err = exec.Command("/usr/bin/codesign", "--verify", "--deep", "--strict", candidate).Run(); err != nil {
		return "", err
	}
	self, err := os.Executable()
	if err != nil {
		return "", err
	}
	if err = copyDesktopFile(self, filepath.Join(directory, "helper"), 0700); err != nil {
		return "", err
	}
	query := parsed.Query()
	query.Set("_pop_refresh", fmt.Sprint(time.Now().UnixNano()))
	parsed.RawQuery = query.Encode()
	state, _ := json.Marshal(desktopUpdateState{os.Getpid(), parsed.String(), update.Version})
	if err = os.WriteFile(filepath.Join(directory, "state.json"), state, 0600); err != nil {
		return "", err
	}
	success = true
	return directory, nil
}

func copyDesktopFile(source, target string, mode os.FileMode) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	// The candidate is a private copy, never the currently running bundle.
	if err = os.Remove(target); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.WriteFile(target, data, mode)
}

func runDesktopUpdateHelper() bool {
	if len(os.Args) != 3 || os.Args[1] != "--apply-desktop-update" {
		return false
	}
	directory := filepath.Clean(os.Args[2])
	home, err := os.UserHomeDir()
	if err != nil {
		return true
	}
	root := filepath.Join(home, ".local", "share", "pop-agent", "desktop-updates")
	if filepath.Dir(directory) != root || !strings.HasPrefix(filepath.Base(directory), "update-") {
		return true
	}
	info, err := os.Lstat(directory)
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 {
		return true
	}
	data, err := os.ReadFile(filepath.Join(directory, "state.json"))
	if err != nil {
		return true
	}
	var state desktopUpdateState
	if json.Unmarshal(data, &state) != nil || state.PID <= 1 || !releaseVersion.MatchString(state.Version) {
		return true
	}
	deadline := time.Now().Add(30 * time.Second)
	for syscall.Kill(state.PID, 0) == nil {
		if time.Now().After(deadline) {
			return true
		}
		time.Sleep(100 * time.Millisecond)
	}
	target := desktopBundle()
	candidate := filepath.Join(directory, "Pop Agent Desktop.app")
	backup := filepath.Join(directory, "previous.app")
	if exec.Command("/usr/bin/codesign", "--verify", "--deep", "--strict", candidate).Run() != nil {
		return true
	}
	err = swapDesktopBundle(target, candidate, backup, func() error {

		ready := filepath.Join(directory, "ready")
		command := exec.Command(filepath.Join(target, "Contents", "MacOS", "Pop Agent Desktop"))
		for _, value := range os.Environ() {
			if !strings.HasPrefix(value, "POP_DESKTOP_UPDATE_READY=") && !strings.HasPrefix(value, "POP_DESKTOP_START_URL=") {
				command.Env = append(command.Env, value)
			}
		}
		command.Env = append(command.Env, "POP_DESKTOP_UPDATE_READY="+ready, "POP_DESKTOP_START_URL="+state.StartURL)
		err = command.Start()
		if err == nil {
			deadline = time.Now().Add(20 * time.Second)
			for time.Now().Before(deadline) {
				if _, e := os.Stat(ready); e == nil {
					_ = command.Process.Release()
					return nil
				}
				time.Sleep(100 * time.Millisecond)
			}
			_ = command.Process.Kill()
			_ = command.Wait()
		}
		return errors.New("New Desktop did not start")
	})
	if err != nil {
		_ = os.WriteFile(filepath.Join(directory, "failed.txt"), []byte(err.Error()), 0600)
		_ = exec.Command("/usr/bin/open", target).Run()
	}
	return true
}

// Only program bundles move; login, drafts, permissions and WebKit storage remain in place.
func swapDesktopBundle(target, candidate, backup string, start func() error) error {
	if err := os.Rename(target, backup); err != nil {
		return err
	}
	if err := os.Rename(candidate, target); err != nil {
		if rollback := os.Rename(backup, target); rollback != nil {
			return fmt.Errorf("Activation failed: %v; recovery failed: %w", err, rollback)
		}
		return err
	}
	if err := start(); err != nil {
		if rollback := os.Rename(target, candidate); rollback != nil {
			return fmt.Errorf("Start failed: %v; recovery failed: %w", err, rollback)
		}
		if rollback := os.Rename(backup, target); rollback != nil {
			return fmt.Errorf("Start failed: %v; recovery failed: %w", err, rollback)
		}
		return err
	}
	return nil
}
