package applifecycle

import (
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

const (
	trayEnvironment = "POP_DESKTOP_TRAY=1"
	showWindow      = byte('s')
)

// DesktopLink owns the two private pipes connecting Pop Desktop to its tray
// helper. Closing the Desktop side makes the helper exit; helper exit closes
// the reverse pipe and stops Desktop.
type DesktopLink struct {
	toTray   *os.File
	fromTray *os.File
	process  *os.Process
	waited   chan struct{}
	close    sync.Once
}

func StartTray(helperPath string) (*DesktopLink, error) {
	if filepath.Base(helperPath) != "Pop Desktop Tray" {
		return nil, errors.New("invalid Pop Desktop Tray helper path")
	}
	trayRead, desktopWrite, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	desktopRead, trayWrite, err := os.Pipe()
	if err != nil {
		trayRead.Close()
		desktopWrite.Close()
		return nil, err
	}
	command := exec.Command(helperPath)
	command.Env = append(os.Environ(), trayEnvironment)
	command.ExtraFiles = []*os.File{trayRead, trayWrite}
	if err := command.Start(); err != nil {
		trayRead.Close()
		desktopWrite.Close()
		desktopRead.Close()
		trayWrite.Close()
		return nil, err
	}
	trayRead.Close()
	trayWrite.Close()
	link := &DesktopLink{
		toTray: desktopWrite, fromTray: desktopRead, process: command.Process, waited: make(chan struct{}),
	}
	go func() {
		_ = command.Wait()
		close(link.waited)
	}()
	return link, nil
}

func (link *DesktopLink) Watch(show func(), stopped func()) {
	go func() {
		buffer := []byte{0}
		for {
			_, err := link.fromTray.Read(buffer)
			if err != nil {
				if stopped != nil {
					stopped()
				}
				return
			}
			if buffer[0] == showWindow && show != nil {
				show()
			}
		}
	}()
}

func (link *DesktopLink) Close() {
	link.close.Do(func() {
		_ = link.toTray.Close()
		_ = link.fromTray.Close()
		select {
		case <-link.waited:
		case <-time.After(5 * time.Second):
			_ = link.process.Kill()
			<-link.waited
		}
	})
}

// TrayLink is constructed only in the embedded helper from descriptors 3 and
// 4. It never opens a public socket or exposes IPC outside the app bundle.
type TrayLink struct {
	fromDesktop *os.File
	toDesktop   *os.File
	mu          sync.Mutex
}

func OpenTray() (*TrayLink, error) {
	if os.Getenv("POP_DESKTOP_TRAY") != "1" {
		return nil, errors.New("Pop Desktop Tray must be started by Pop Desktop")
	}
	fromDesktop := os.NewFile(3, "pop-desktop-parent")
	toDesktop := os.NewFile(4, "pop-desktop-control")
	if fromDesktop == nil || toDesktop == nil {
		return nil, errors.New("Pop Desktop Tray lifecycle pipes are unavailable")
	}
	return &TrayLink{fromDesktop: fromDesktop, toDesktop: toDesktop}, nil
}

func (link *TrayLink) WatchDesktop(stopped func()) {
	go func() {
		_, _ = io.Copy(io.Discard, link.fromDesktop)
		if stopped != nil {
			stopped()
		}
	}()
}

func (link *TrayLink) ShowDesktop() error {
	link.mu.Lock()
	defer link.mu.Unlock()
	_, err := link.toDesktop.Write([]byte{showWindow})
	return err
}

func (link *TrayLink) Close() error {
	return errors.Join(link.fromDesktop.Close(), link.toDesktop.Close())
}
