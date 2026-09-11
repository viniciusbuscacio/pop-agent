package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var version = "dev"

const projectURL = "https://github.com/viniciusbuscacio/pop-agent"

type payloadEntry struct {
	File   string `json:"file"`
	Size   int    `json:"size"`
	SHA256 string `json:"sha256"`
}
type payloadManifest struct {
	Version  string       `json:"version"`
	Tray     payloadEntry `json:"tray"`
	Launcher payloadEntry `json:"launcher"`
}

func verifiedPayload(source fs.FS) (map[string][]byte, error) {
	data, err := fs.ReadFile(source, "manifest.json")
	if err != nil {
		return nil, errors.New("The installer payload is missing. Download the installer again.")
	}
	var manifest payloadManifest
	if json.Unmarshal(data, &manifest) != nil || manifest.Version != version {
		return nil, errors.New("The installer payload version is invalid.")
	}
	result := map[string][]byte{}
	for name, entry := range map[string]payloadEntry{"tray": manifest.Tray, "launcher": manifest.Launcher} {
		if entry.File != name+".exe" || entry.Size < 2 || entry.Size > 128<<20 || len(entry.SHA256) != 64 {
			return nil, errors.New("Invalid installer payload metadata.")
		}
		content, err := fs.ReadFile(source, entry.File)
		digest := sha256.Sum256(content)
		if err != nil || len(content) != entry.Size || !bytes.HasPrefix(content, []byte("MZ")) || hex.EncodeToString(digest[:]) != entry.SHA256 {
			return nil, fmt.Errorf("The %s payload failed integrity verification.", name)
		}
		result[name] = content
	}
	return result, nil
}

func serverOrigin(value string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(value))
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("Enter the server address only, without a path, password or query.")
	}
	loopback := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1"
	if u.Scheme != "https" && !(u.Scheme == "http" && loopback) {
		return "", errors.New("Use HTTPS for your Pop Agent server.")
	}
	return u.Scheme + "://" + u.Host, nil
}

// The browser download source is only a suggestion. The wizard always asks the owner to confirm it.
func originFromDownload(data []byte) string {
	if len(data) > 64<<10 {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(strings.TrimSpace(line), "HostUrl=") {
			continue
		}
		u, err := url.Parse(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "HostUrl=")))
		if err == nil && u.User == nil {
			origin, _ := serverOrigin(u.Scheme + "://" + u.Host)
			return origin
		}
	}
	return ""
}

type profileSnapshot struct {
	data   []byte
	exists bool
	server string
	token  string
}

func readBoundedFile(path string, maximum int64) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() || info.Size() > maximum {
		return nil, errors.New("Not a bounded regular file.")
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maximum+1))
	if int64(len(data)) > maximum {
		return nil, errors.New("File exceeds its size limit.")
	}
	return data, err
}

func readProfile(path string) (profileSnapshot, error) {
	data, err := readBoundedFile(path, 1<<20)
	if os.IsNotExist(err) {
		return profileSnapshot{}, nil
	}
	if err != nil || len(data) > 1<<20 {
		return profileSnapshot{}, errors.New("Could not read the saved Pop login safely.")
	}
	var profiles map[string]json.RawMessage
	if json.Unmarshal(data, &profiles) != nil || profiles == nil {
		return profileSnapshot{}, errors.New("The saved Pop profiles file is invalid; it has not been changed.")
	}
	var profile struct {
		URL   string `json:"url"`
		Token string `json:"token"`
	}
	if raw, ok := profiles["default"]; ok && json.Unmarshal(raw, &profile) != nil {
		return profileSnapshot{}, errors.New("The saved default profile is invalid.")
	}
	return profileSnapshot{data: data, exists: true, server: profile.URL, token: profile.Token}, nil
}
func updatedProfiles(before profileSnapshot, server, token string) ([]byte, error) {
	profiles := map[string]json.RawMessage{}
	if before.exists && json.Unmarshal(before.data, &profiles) != nil {
		return nil, errors.New("Could not preserve saved profiles.")
	}
	current := map[string]json.RawMessage{}
	if raw, ok := profiles["default"]; ok {
		if json.Unmarshal(raw, &current) != nil || current == nil {
			return nil, errors.New("Invalid saved profile.")
		}
	}
	current["url"], _ = json.Marshal(server)
	current["token"], _ = json.Marshal(token)
	profiles["default"], _ = json.Marshal(current)
	out, err := json.MarshalIndent(profiles, "", "  ")
	return append(out, '\n'), err
}
func unchangedProfile(path string, before profileSnapshot) bool {
	current, err := readBoundedFile(path, 1<<20)
	if !before.exists {
		return os.IsNotExist(err)
	}
	return err == nil && bytes.Equal(current, before.data)
}

func login(ctx context.Context, server, password string) (string, error) {
	origin, err := serverOrigin(server)
	if err != nil {
		return "", err
	}
	if password == "" {
		return "", errors.New("Enter your Pop Agent password.")
	}
	body, _ := json.Marshal(map[string]string{"password": password})
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, origin+"/v1/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return "", errors.New("Could not reach the server securely. Check Tailscale and the server address.")
	}
	defer response.Body.Close()
	if response.StatusCode == 401 {
		return "", errors.New("Incorrect password. Please try again.")
	}
	if response.StatusCode == 429 {
		return "", errors.New("Too many attempts. Wait before trying again.")
	}
	if response.StatusCode != 200 {
		return "", errors.New("Sign-in did not complete. Check the server address and try again.")
	}
	var result struct {
		Token string `json:"token"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&result) != nil || result.Token == "" || len(result.Token) > 16<<10 {
		return "", errors.New("The server returned an invalid sign-in response.")
	}
	return result.Token, nil
}

func savedSessionValid(ctx context.Context, server, token string) bool {
	origin, err := serverOrigin(server)
	if err != nil {
		return false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, origin+"/v1/settings", nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", "Bearer "+token)
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode == 200
}

func atomicFile(path string, data []byte, mode fs.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	if info, err := os.Lstat(path); err == nil && !info.Mode().IsRegular() {
		return errors.New("Refusing to replace a non-regular file.")
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".pop-setup-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err = f.Chmod(mode); err == nil {
		_, err = f.Write(data)
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(f.Name(), path)
}
