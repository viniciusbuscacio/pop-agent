package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const SchemaVersion = 1

type Config struct {
	SchemaVersion int    `json:"schemaVersion"`
	ServerURL     string `json:"serverURL"`
	LocalPort     int    `json:"localPort"`
	StartAtLogin  bool   `json:"startAtLogin"`
	PWAAppPath    string `json:"pwaAppPath"`
}

func Default() Config { return Config{SchemaVersion: SchemaVersion} }

func DefaultPath() (string, error) {
	root, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("locate Application Support: %w", err)
	}
	return filepath.Join(root, "Pop Agent", "config.json"), nil
}

func LoadOrCreate(path string) (Config, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		cfg := Default()
		return cfg, Save(path, cfg)
	}
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	if cfg.SchemaVersion != SchemaVersion {
		return Config{}, fmt.Errorf("unsupported config schema %d", cfg.SchemaVersion)
	}
	return cfg, nil
}

func Save(path string, cfg Config) error {
	cfg.SchemaVersion = SchemaVersion
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	data = append(data, '\n')
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".config-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary config: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("protect temporary config: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write temporary config: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("sync temporary config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close temporary config: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	return nil
}
