package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type loginProfile struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

func profilePath() (string, error) {
	base := os.Getenv("XDG_CONFIG_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", err
		}
		base = filepath.Join(home, ".config")
	}
	return filepath.Join(base, "pop-agent", "profiles.json"), nil
}

func readProfiles(path string) (map[string]json.RawMessage, loginProfile, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, loginProfile{}, errors.New("No saved server. Install Pop Local Access from Settings → Devices first.")
	}
	var profiles map[string]json.RawMessage
	var profile loginProfile
	if json.Unmarshal(data, &profiles) != nil || json.Unmarshal(profiles["default"], &profile) != nil {
		return nil, profile, errors.New("The saved server configuration could not be read.")
	}
	if !validLoginURL(profile.URL) {
		return nil, profile, errors.New("Sign-in requires a secure HTTPS server address.")
	}
	return profiles, profile, nil
}

func validLoginURL(value string) bool {
	u, err := url.Parse(value)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return false
	}
	return u.Scheme == "https" || (u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1" || u.Hostname() == "localhost"))
}

// No redirects: a password is sent only to the server shown in the native dialog.
func requestLogin(ctx context.Context, server, password string) (string, error) {
	if !validLoginURL(server) {
		return "", errors.New("Sign-in requires a secure HTTPS server address.")
	}
	body, _ := json.Marshal(map[string]string{"password": password})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(server, "/")+"/v1/login", bytes.NewReader(body))
	if err != nil {
		return "", errors.New("The server address is invalid.")
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	response, err := client.Do(req)
	if err != nil {
		return "", errors.New("Could not reach the server securely. Check your connection and try again.")
	}
	defer response.Body.Close()
	switch response.StatusCode {
	case http.StatusOK:
		var result struct {
			Token string `json:"token"`
		}
		if json.NewDecoder(io.LimitReader(response.Body, 64<<10)).Decode(&result) != nil || result.Token == "" || len(result.Token) > 16<<10 {
			return "", errors.New("The server returned an invalid sign-in response.")
		}
		return result.Token, nil
	case http.StatusUnauthorized:
		return "", errors.New("Incorrect password. Please try signing in again.")
	case http.StatusTooManyRequests:
		return "", errors.New("Too many sign-in attempts. Wait a few minutes before trying again.")
	default:
		return "", errors.New("Sign-in was not completed. Open Pop Agent to check the server status.")
	}
}

func saveLogin(path string, expected loginProfile, token string) error {
	profiles, current, err := readProfiles(path)
	if err != nil {
		return err
	}
	if current != expected {
		return errors.New("The saved login changed. Please sign in again.")
	}
	profiles["default"], _ = json.Marshal(loginProfile{URL: current.URL, Token: token})
	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return errors.New("Could not save sign-in.")
	}
	if err = os.Chmod(filepath.Dir(path), 0700); err != nil {
		return errors.New("Could not protect the sign-in folder.")
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".profiles-*")
	if err != nil {
		return errors.New("Could not save sign-in.")
	}
	defer os.Remove(file.Name())
	_, writeErr := file.Write(append(data, '\n'))
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		return errors.New("Could not save sign-in.")
	}
	if os.Rename(file.Name(), path) != nil {
		return errors.New("Could not save sign-in.")
	}
	return nil
}

func (a *app) signIn() {
	a.mu.Lock()
	if a.signingIn || a.quitting {
		a.mu.Unlock()
		return
	}
	a.signingIn = true
	a.mu.Unlock()
	a.publish()
	defer func() { a.mu.Lock(); a.signingIn = false; a.mu.Unlock(); a.publish() }()
	path, err := profilePath()
	if err != nil {
		showSignInError("Could not find the saved server configuration.")
		return
	}
	_, profile, err := readProfiles(path)
	if err != nil {
		showSignInError(err.Error())
		return
	}
	password, ok := promptPassword(safeOrigin(profile.URL))
	if !ok {
		return
	}
	a.mu.Lock()
	a.status = "Signing in…"
	a.mu.Unlock()
	a.publish()
	token, err := requestLogin(a.ctx, profile.URL, password)
	password = ""
	if err == nil {
		err = saveLogin(path, profile, token)
	}
	if err != nil {
		a.mu.Lock()
		a.status = "Sign-in required"
		a.accessKnown = false
		a.mu.Unlock()
		a.publish()
		showSignInError(err.Error())
		return
	}
	a.reconnect()
}

func (a *app) activateStatus() {
	a.mu.Lock()
	requiresLogin := a.status == "Sign-in required"
	a.mu.Unlock()
	if requiresLogin && nativeSignInAvailable {
		a.signIn()
	} else {
		a.reconnect()
	}
}
