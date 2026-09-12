package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"sync"
	"syscall"
	"time"
)

const trayVersion = "0.2.101"

type childEvent struct {
	Kind      string `json:"kind"`
	Server    string `json:"server"`
	Transport string `json:"transport"`
	Minimum   string `json:"minimum"`
	Enabled   *bool  `json:"enabled"`
}

type app struct {
	updateTitle     string
	updateBusy      bool
	availableUpdate *installerUpdate
	updateServer    string
	mu              sync.Mutex
	ctx             context.Context
	cancel          context.CancelFunc
	command         *exec.Cmd
	commandInput    io.WriteCloser
	server          string
	status          string
	accessEnabled   bool
	accessKnown     bool
	connected       bool
	quitting        bool
	signingIn       bool
	log             *os.File
	view            trayView
}

func main() {
	if runDesktopUpdateHelper() {
		return
	}
	if runDesktopIfRequested() {
		return
	}
	if runSetupIfRequested() {
		return
	}
	if runtime.GOOS != "darwin" && runtime.GOOS != "windows" {
		fmt.Fprintln(os.Stderr, "Pop Local Access tray currently supports Windows and macOS.")
		os.Exit(1)
	}
	if err := singleInstance(); err != nil {
		if errors.Is(err, errAlreadyRunning) {
			return
		}
		fmt.Fprintln(os.Stderr, "pop-local-access:", err)
		os.Exit(1)
	}
	log, err := openLog()
	if err != nil {
		fmt.Fprintln(os.Stderr, "pop-local-access:", err)
		os.Exit(1)
	}
	defer log.Close()
	if err := installAppIcon(); err != nil {
		fmt.Fprintln(log, "app icon:", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	a := &app{ctx: ctx, cancel: cancel, status: "Starting", log: log}
	if err := installTray(a); err != nil {
		fmt.Fprintln(log, "tray:", err)
		os.Exit(1)
	}
	go a.start()
	go a.updateLoop()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	go func() {
		<-signals
		a.quit()
	}()
	runTray()
}

func (a *app) snapshot() viewState {
	a.mu.Lock()
	defer a.mu.Unlock()
	autostart, _ := startAtLoginEnabled()
	return viewState{
		Server: a.server, Status: a.status, Connected: a.connected, AccessEnabled: a.accessEnabled,
		AccessKnown: a.accessKnown, StartAtLogin: autostart,
		SigningIn: a.signingIn, UpdateTitle: a.updateTitle, UpdateBusy: a.updateBusy,
		UpdateAvailable: a.availableUpdate != nil,
	}
}

func (a *app) publish() { a.view.Update(a.snapshot()) }

func (a *app) start() {
	a.mu.Lock()
	if a.quitting || a.command != nil {
		a.mu.Unlock()
		return
	}
	a.connected = false
	a.accessKnown = false
	pop, err := popPath()
	if err != nil {
		a.status = "Pop CLI not installed"
		a.mu.Unlock()
		a.publish()
		return
	}
	cmd := childCommand(a.ctx, pop, "local-access", "--status-json")
	home, _ := os.UserHomeDir()
	cmd.Dir = home
	cmd.SysProcAttr = childProcessAttributes()
	stdout, err := cmd.StdoutPipe()
	var stdin io.WriteCloser
	if err == nil {
		stdin, err = cmd.StdinPipe()
	}
	if err == nil {
		cmd.Stderr = a.log
		err = cmd.Start()
	}
	if err != nil {
		a.status = "Could not start"
		fmt.Fprintln(a.log, "start:", err)
		a.mu.Unlock()
		a.publish()
		return
	}
	a.command = cmd
	a.commandInput = stdin
	a.accessKnown = false
	a.status = "Connecting"
	a.mu.Unlock()
	a.publish()
	go a.scan(stdout, cmd)
	go func() {
		err := cmd.Wait()
		a.mu.Lock()
		owned := a.command == cmd
		if owned {
			a.connected = false
			a.accessKnown = false
			a.command = nil
			a.commandInput = nil
		}
		shouldRestart := !a.quitting && owned
		if shouldRestart {
			a.status = "Disconnected — reconnecting"
		}
		a.mu.Unlock()
		if err != nil {
			fmt.Fprintln(a.log, "local access exited:", err)
		}
		a.publish()
		if shouldRestart {
			time.Sleep(5 * time.Second)
			a.start()
		}
	}()
}

func (a *app) scan(reader io.Reader, cmd *exec.Cmd) {
	scanner := bufio.NewScanner(io.LimitReader(reader, 1<<20))
	for scanner.Scan() {
		var event childEvent
		if json.Unmarshal(scanner.Bytes(), &event) != nil {
			continue
		}
		a.mu.Lock()
		if a.command != cmd {
			a.mu.Unlock()
			continue
		}
		switch event.Kind {
		case "starting":
			a.connected = false
			a.accessKnown = false
			a.server = safeOrigin(event.Server)
			a.status = "Connecting"
		case "attached":
			a.connected = true
			a.status = "Checking access"
		case "access-policy":
			if event.Enabled != nil {
				a.connected = true
				a.accessEnabled = *event.Enabled
				a.accessKnown = true
				if a.accessEnabled {
					a.status = "Access enabled"
				} else {
					a.status = "Access disabled"
				}
			}
		case "closed":
			a.connected = false
			a.accessKnown = false
			a.status = "Disconnected — reconnecting"
		case "authentication-required":
			a.connected = false
			a.accessKnown = false
			a.status = "Sign-in required"
		case "outdated":
			a.connected = false
			a.accessKnown = false
			a.status = "Update required"
		}
		a.mu.Unlock()
		a.publish()
	}
}

func (a *app) stop() {
	a.mu.Lock()
	cmd := a.command
	a.command = nil
	a.commandInput = nil
	a.connected = false
	a.accessKnown = false
	a.mu.Unlock()
	if cmd != nil {
		terminateChild(cmd)
	}
}

func (a *app) toggleAccess() {
	a.mu.Lock()
	input := a.commandInput
	enabled := !a.accessEnabled
	known := a.accessKnown
	a.mu.Unlock()
	if input == nil || !known {
		return
	}
	if _, err := fmt.Fprintf(input, "{\"kind\":\"set-access\",\"enabled\":%t}\n", enabled); err != nil {
		fmt.Fprintln(a.log, "set access:", err)
	}
}

func (a *app) reconnect() {
	a.mu.Lock()
	a.status = "Connecting"
	a.connected = false
	a.accessKnown = false
	a.mu.Unlock()
	a.stop()
	go a.start()
	a.publish()
}

func (a *app) toggleStartAtLogin() {
	enabled, _ := startAtLoginEnabled()
	if err := setStartAtLogin(!enabled); err != nil {
		fmt.Fprintln(a.log, "start at login:", err)
	}
	a.publish()
}

func (a *app) openPop() {
	a.mu.Lock()
	server := a.server
	a.mu.Unlock()
	if server != "" {
		_ = openDesktop(server)
	}
}

func (a *app) diagnostics() { _ = openExternal(a.log.Name()) }

func (a *app) quit() {
	a.mu.Lock()
	a.quitting = true
	a.mu.Unlock()
	a.stop()
	closeDesktopWindow()
	a.cancel()
	stopTray()
}

func popPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	path := filepath.Join(home, ".local", "bin", "pop")
	if runtime.GOOS == "darwin" {
		private := filepath.Join(home, "Library", "Application Support", "Pop Agent", "runtime", "pop")
		if info, e := os.Stat(private); e == nil && info.Mode().IsRegular() {
			path = private
		}
	}
	if runtime.GOOS == "windows" {
		path = filepath.Join(os.Getenv("LOCALAPPDATA"), "PopAgent", "bin", "pop.exe")
		if self, err := os.Executable(); err == nil {
			private := filepath.Join(filepath.Dir(self), "runtime", "pop.exe")
			if info, err := os.Stat(private); err == nil && info.Mode().IsRegular() {
				path = private
			}
		}
	}
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	return path, nil
}

func safeOrigin(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

func openLog() (*os.File, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	dir := filepath.Join(home, ".local", "state", "pop-agent")
	if runtime.GOOS == "darwin" {
		dir = filepath.Join(home, "Library", "Logs", "Pop Agent")
	} else if runtime.GOOS == "windows" {
		dir = filepath.Join(os.Getenv("LOCALAPPDATA"), "Pop Agent", "Logs")
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(dir, "local-access.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
}

// Cancellation must keep the launcher alive until tree termination has found its children.
func childCommand(ctx context.Context, path string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, path, args...)
	cmd.Cancel = func() error { terminateChild(cmd); return nil }
	return cmd
}
