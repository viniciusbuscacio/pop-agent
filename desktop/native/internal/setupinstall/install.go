package setupinstall

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/bootstrap"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/config"
)

type Credentials struct {
	ServerURL string
	Token     string
}

type Runner func(name string, args ...string) error

type Installer struct {
	Home       string
	ConfigPath string
	PayloadApp string
	Run        Runner
	Now        func() time.Time
	Progress   func(string)
}

type cliProfile struct {
	URL   string `json:"url"`
	Token string `json:"token"`
}

// Install stages the signed application, asks its bundled launcher to install
// the managed Node runtime and CLI, then atomically activates the app bundle.
func (installer Installer) Install(credentials Credentials) (string, error) {
	if credentials.ServerURL == "" || credentials.Token == "" {
		return "", errors.New("server URL and session token are required")
	}
	if installer.Home == "" || installer.ConfigPath == "" || installer.PayloadApp == "" || installer.Run == nil {
		return "", errors.New("setup installer is incomplete")
	}
	if installer.Now == nil {
		installer.Now = time.Now
	}

	helperSource := filepath.Join(installer.PayloadApp, "Contents", "Helpers", "pop")
	if info, err := os.Stat(helperSource); err != nil || !info.Mode().IsRegular() || info.Mode()&0o111 == 0 {
		return "", errors.New("Pop Desktop Setup is missing its launcher payload")
	}

	installer.report("Saving your Pop Agent connection…")
	cfg := config.Default()
	cfg.ServerURL = credentials.ServerURL
	if err := config.Save(installer.ConfigPath, cfg); err != nil {
		return "", err
	}
	if err := installer.writeProfile(credentials); err != nil {
		return "", err
	}
	if err := installer.writeBootstrap(credentials); err != nil {
		return "", err
	}

	applications := filepath.Join(installer.Home, "Applications")
	if err := os.MkdirAll(applications, 0o755); err != nil {
		return "", fmt.Errorf("create user Applications directory: %w", err)
	}
	finalApp := filepath.Join(applications, "Pop Desktop.app")
	stageApp := filepath.Join(applications, fmt.Sprintf(".Pop Desktop.install-%d", installer.Now().UnixNano()))
	defer os.RemoveAll(stageApp)
	installer.report("Preparing Pop Desktop…")
	if err := copyTree(installer.PayloadApp, stageApp); err != nil {
		return "", fmt.Errorf("stage Pop Desktop: %w", err)
	}
	stageHelper := filepath.Join(stageApp, "Contents", "Helpers", "pop")
	installer.report("Installing private Node.js…")
	if err := installer.Run(stageHelper, "runtime", "install"); err != nil {
		return "", fmt.Errorf("install private Node.js: %w", err)
	}
	installer.report("Installing Pop CLI…")
	if err := installer.Run(stageHelper, "update"); err != nil {
		return "", fmt.Errorf("install Pop CLI: %w", err)
	}
	installer.report("Finishing installation…")
	if err := installer.installLauncher(stageHelper); err != nil {
		return "", err
	}
	if err := activate(stageApp, finalApp); err != nil {
		return "", err
	}
	if err := installer.ensureShellPath(); err != nil {
		return "", err
	}
	return finalApp, nil
}

func (installer Installer) report(message string) {
	if installer.Progress != nil {
		installer.Progress(message)
	}
}

func (installer Installer) writeProfile(credentials Credentials) error {
	path := filepath.Join(installer.Home, ".config", "pop-agent", "profiles.json")
	profiles := map[string]cliProfile{}
	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &profiles); err != nil {
			return fmt.Errorf("read existing Pop CLI profiles: %w", err)
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read existing Pop CLI profiles: %w", err)
	}
	profiles["default"] = cliProfile{URL: credentials.ServerURL, Token: credentials.Token}
	return writeJSON(path, profiles, 0o600)
}

func (installer Installer) writeBootstrap(credentials Credentials) error {
	path := filepath.Join(filepath.Dir(installer.ConfigPath), "bootstrap-session.json")
	return writeJSON(path, bootstrap.Session{ServerURL: credentials.ServerURL, Token: credentials.Token}, 0o600)
}

func (installer Installer) installLauncher(source string) error {
	destination := filepath.Join(installer.Home, ".local", "bin", "pop")
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return fmt.Errorf("create launcher directory: %w", err)
	}
	if err := copyFileAtomic(source, destination, 0o755); err != nil {
		return fmt.Errorf("install Pop launcher: %w", err)
	}
	return nil
}

const pathMarker = "# Pop Agent launcher"

func (installer Installer) ensureShellPath() error {
	path := filepath.Join(installer.Home, ".zprofile")
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("read .zprofile: %w", err)
	}
	if strings.Contains(string(data), pathMarker) {
		return nil
	}
	line := "\n" + pathMarker + "\nexport PATH=\"$HOME/.local/bin:$PATH\"\n"
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return fmt.Errorf("update .zprofile: %w", err)
	}
	defer file.Close()
	if _, err := file.WriteString(line); err != nil {
		return fmt.Errorf("update .zprofile: %w", err)
	}
	return file.Sync()
}

func activate(stage, final string) error {
	backup := final + ".previous"
	_ = os.RemoveAll(backup)
	if _, err := os.Stat(final); err == nil {
		if err := os.Rename(final, backup); err != nil {
			return fmt.Errorf("stage previous Pop Desktop: %w", err)
		}
	}
	if err := os.Rename(stage, final); err != nil {
		_ = os.Rename(backup, final)
		return fmt.Errorf("activate Pop Desktop: %w", err)
	}
	_ = os.RemoveAll(backup)
	return nil
}

func writeJSON(path string, value any, mode fs.FileMode) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	directory := filepath.Dir(path)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return err
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(directory, ".setup-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(name, path); err != nil {
		return err
	}
	return os.Chmod(path, mode)
}

func copyTree(source, destination string) error {
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		target := filepath.Join(destination, relative)
		info, err := entry.Info()
		if err != nil {
			return err
		}
		switch {
		case entry.IsDir():
			return os.MkdirAll(target, info.Mode().Perm())
		case info.Mode().IsRegular():
			return copyFileAtomic(path, target, info.Mode().Perm())
		default:
			return fmt.Errorf("payload contains unsupported entry %s", relative)
		}
	})
}

func copyFileAtomic(source, destination string, mode fs.FileMode) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(destination), ".copy-*.tmp")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(mode); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, destination)
}
