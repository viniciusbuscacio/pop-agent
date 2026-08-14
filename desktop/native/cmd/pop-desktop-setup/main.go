//go:build darwin

package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/viniciusbuscacio/pop-desktop-manager/internal/config"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/serverclient"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/setupinstall"
	"github.com/viniciusbuscacio/pop-desktop-manager/internal/setupui"
)

type installResult struct {
	app string
	err error
}

func main() {
	runtime.LockOSThread()
	if runtime.GOARCH != "arm64" {
		setupui.ShowError("This release requires a Mac with Apple silicon.")
		return
	}
	if !setupui.Welcome() {
		return
	}

	executable, err := os.Executable()
	if err != nil {
		setupui.ShowError("Setup could not locate its application bundle.")
		return
	}
	payload := filepath.Join(filepath.Dir(filepath.Dir(executable)), "Resources", "Pop Desktop.app")
	if err := verifyPayload(payload); err != nil {
		setupui.ShowError("The Pop Desktop payload is damaged or has an invalid signature.")
		return
	}
	home, err := os.UserHomeDir()
	if err != nil {
		setupui.ShowError("Setup could not locate your home folder.")
		return
	}
	configPath, err := config.DefaultPath()
	if err != nil {
		setupui.ShowError("Setup could not locate your Application Support folder.")
		return
	}

	initialURL := ""
	for {
		entered, ok := setupui.AskCredentials(initialURL)
		if !ok {
			return
		}
		origin, err := serverclient.NormalizeURL(entered.ServerURL)
		if err != nil {
			setupui.ShowError(err.Error())
			initialURL = entered.ServerURL
			continue
		}
		if strings.TrimSpace(entered.Password) == "" {
			setupui.ShowError("Enter your Pop Agent password.")
			initialURL = origin
			continue
		}

		setupui.BeginProgress()
		result := make(chan installResult, 1)
		go func() {
			defer setupui.FinishProgress()
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			token, loginErr := serverclient.New().Login(ctx, origin, entered.Password)
			cancel()
			if loginErr != nil {
				result <- installResult{err: publicError(loginErr)}
				return
			}
			installer := setupinstall.Installer{
				Home: home, ConfigPath: configPath, PayloadApp: payload,
				Run:      runCommand,
				Progress: setupui.SetProgress,
			}
			app, installErr := installer.Install(setupinstall.Credentials{ServerURL: origin, Token: token})
			result <- installResult{app: app, err: installErr}
		}()
		setupui.RunProgress()
		installed := <-result
		if installed.err != nil {
			setupui.ShowError(installed.err.Error())
			initialURL = origin
			continue
		}
		if setupui.ShowSuccess() {
			if err := exec.Command("/usr/bin/open", installed.app).Start(); err != nil {
				setupui.ShowError("Pop Desktop was installed, but Setup could not open it.")
			}
		}
		return
	}
}

func verifyPayload(path string) error {
	if _, err := os.Stat(path); err != nil {
		return err
	}
	command := exec.Command("/usr/bin/codesign", "--verify", "--deep", "--strict", path)
	return command.Run()
}

func runCommand(name string, args ...string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	var output bytes.Buffer
	command := exec.CommandContext(ctx, name, args...)
	command.Stdout = &output
	command.Stderr = &output
	if err := command.Run(); err != nil {
		message := strings.TrimSpace(output.String())
		if len(message) > 800 {
			message = message[len(message)-800:]
		}
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return errors.New("installation timed out; check your connection and try again")
		}
		if message != "" {
			return fmt.Errorf("%s", message)
		}
		return err
	}
	return nil
}

func publicError(err error) error {
	if serverclient.IsKind(err, serverclient.InvalidCredentials) {
		return errors.New("The password is incorrect. Try again")
	}
	if serverclient.IsKind(err, serverclient.Offline) {
		return errors.New("Your Pop Agent could not be reached. Check the address and your connection")
	}
	return errors.New("Your Pop Agent could not authenticate Setup. Try again")
}
