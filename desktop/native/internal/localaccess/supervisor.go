package localaccess

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

type Event struct {
	Kind         string `json:"kind"`
	ConnectionID string `json:"connectionId"`
	Transport    string `json:"transport"`
	Code         string `json:"code"`
}

type Config struct {
	NodePath  string
	EntryPath string
	ServerURL string
	Token     string
}

type Supervisor struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	done    chan error
	onEvent func(Event)
}

func New(onEvent func(Event)) *Supervisor { return &Supervisor{onEvent: onEvent} }

func (s *Supervisor) Running() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cmd != nil
}

func (s *Supervisor) Start(ctx context.Context, cfg Config) error {
	if cfg.NodePath == "" || cfg.EntryPath == "" || cfg.ServerURL == "" || cfg.Token == "" {
		return errors.New("local access requires Node, CLI, server URL, and session")
	}
	s.mu.Lock()
	if s.cmd != nil {
		s.mu.Unlock()
		return nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		s.mu.Unlock()
		return fmt.Errorf("find user home: %w", err)
	}
	cmd := exec.CommandContext(ctx, cfg.NodePath, cfg.EntryPath, "--managed-local-access")
	cmd.Dir = home
	cmd.Env = withPath(filepath.Dir(cfg.NodePath), os.Environ())
	cmd.SysProcAttr = processGroupAttributes()
	stdin, err := cmd.StdinPipe()
	if err != nil {
		s.mu.Unlock()
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		s.mu.Unlock()
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		s.mu.Unlock()
		return err
	}
	if err := cmd.Start(); err != nil {
		s.mu.Unlock()
		return fmt.Errorf("start managed local access: %w", err)
	}
	done := make(chan error, 1)
	s.cmd = cmd
	s.stdin = stdin
	s.done = done
	s.mu.Unlock()

	config := map[string]any{"kind": "start", "protocol": 1, "url": cfg.ServerURL, "token": cfg.Token, "role": "managed-default"}
	if err := s.write(config); err != nil {
		s.Stop(2 * time.Second)
		return fmt.Errorf("configure managed local access: %w", err)
	}
	go s.scan(stdout)
	go drain(stderr)
	go func() {
		err := cmd.Wait()
		s.mu.Lock()
		if s.cmd == cmd {
			_ = s.stdin.Close()
			s.cmd = nil
			s.stdin = nil
			s.done = nil
		}
		s.mu.Unlock()
		done <- err
		close(done)
	}()
	return nil
}

// UpdateToken keeps the existing process and in-flight calls alive. The CLI
// uses the new session for subsequent HTTP requests and reconnects.
func (s *Supervisor) UpdateToken(token string) error {
	if token == "" {
		return errors.New("local access session is empty")
	}
	return s.write(map[string]any{"kind": "session", "token": token})
}

func (s *Supervisor) write(message any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.cmd == nil || s.stdin == nil {
		return errors.New("local access is not running")
	}
	return json.NewEncoder(s.stdin).Encode(message)
}

func (s *Supervisor) Stop(timeout time.Duration) {
	s.mu.Lock()
	cmd := s.cmd
	done := s.done
	s.mu.Unlock()
	if cmd == nil {
		return
	}
	terminateProcessGroup(cmd)
	if done != nil {
		select {
		case <-done:
			return
		case <-time.After(timeout):
		}
	}
	killProcessGroup(cmd)
	if done != nil {
		select {
		case <-done:
		case <-time.After(time.Second):
		}
	}
}

func (s *Supervisor) scan(reader io.Reader) {
	scanner := bufio.NewScanner(io.LimitReader(reader, 1<<20))
	scanner.Buffer(make([]byte, 1024), 64<<10)
	for scanner.Scan() {
		var event Event
		if json.Unmarshal(scanner.Bytes(), &event) != nil || event.Kind == "" {
			continue
		}
		if s.onEvent != nil {
			s.onEvent(event)
		}
	}
}

func drain(reader io.Reader) {
	_, _ = io.Copy(io.Discard, io.LimitReader(reader, 64<<10))
}

func withPath(prefix string, environment []string) []string {
	result := make([]string, 0, len(environment)+1)
	set := false
	for _, variable := range environment {
		if len(variable) >= 5 && variable[:5] == "PATH=" {
			result = append(result, "PATH="+prefix+string(os.PathListSeparator)+variable[5:])
			set = true
		} else {
			result = append(result, variable)
		}
	}
	if !set {
		result = append(result, "PATH="+prefix)
	}
	return result
}
