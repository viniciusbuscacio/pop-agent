//go:build darwin

package desktopwindow

/*
#cgo CFLAGS: -fblocks
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#include <stdlib.h>
int pop_desktop_install(const char *serverURL, const char *initialToken);
void pop_desktop_set_server_url(const char *serverURL);
void pop_desktop_show(void);
void pop_desktop_run(void);
void pop_desktop_stop(void);
void pop_desktop_remove(void);
void pop_desktop_show_fatal(const char *message);
int pop_desktop_navigation_disposition_for_testing(const char *serverURL, const char *candidateURL);
int pop_desktop_session_origin_allowed_for_testing(const char *serverURL, const char *frameURL, int isMainFrame);
int pop_desktop_terminates_after_last_window_for_testing(void);
*/
import "C"

import (
	"fmt"
	"sync"
	"unsafe"
)

var (
	sessionHandlerMu sync.Mutex
	sessionUpdates   chan string
)

func install(serverURL, initialToken string, onSession SessionHandler) error {
	updates := make(chan string, 8)
	go func() {
		for token := range updates {
			onSession(token)
		}
	}()
	sessionHandlerMu.Lock()
	if sessionUpdates != nil {
		sessionHandlerMu.Unlock()
		close(updates)
		return nil
	}
	sessionUpdates = updates
	sessionHandlerMu.Unlock()

	value := C.CString(serverURL)
	token := C.CString(initialToken)
	defer C.free(unsafe.Pointer(value))
	defer C.free(unsafe.Pointer(token))
	if C.pop_desktop_install(value, token) == 0 {
		sessionHandlerMu.Lock()
		sessionUpdates = nil
		close(updates)
		sessionHandlerMu.Unlock()
		return fmt.Errorf("AppKit did not create the Pop Desktop window host")
	}
	return nil
}

func setServerURL(serverURL string) {
	value := C.CString(serverURL)
	defer C.free(unsafe.Pointer(value))
	C.pop_desktop_set_server_url(value)
}

func show() { C.pop_desktop_show() }
func run()  { C.pop_desktop_run() }
func stop() { C.pop_desktop_stop() }

func remove() {
	C.pop_desktop_remove()
	sessionHandlerMu.Lock()
	updates := sessionUpdates
	sessionUpdates = nil
	sessionHandlerMu.Unlock()
	if updates != nil {
		close(updates)
	}
}

//export popDesktopSessionChanged
func popDesktopSessionChanged(value *C.char) {
	token := C.GoString(value)
	sessionHandlerMu.Lock()
	defer sessionHandlerMu.Unlock()
	if sessionUpdates != nil {
		sessionUpdates <- token
	}
}

func showFatal(message string) {
	value := C.CString(message)
	defer C.free(unsafe.Pointer(value))
	C.pop_desktop_show_fatal(value)
}

func navigationDispositionForTesting(serverURL, candidateURL string) int {
	server := C.CString(serverURL)
	candidate := C.CString(candidateURL)
	defer C.free(unsafe.Pointer(server))
	defer C.free(unsafe.Pointer(candidate))
	return int(C.pop_desktop_navigation_disposition_for_testing(server, candidate))
}

func terminatesAfterLastWindowForTesting() bool {
	return C.pop_desktop_terminates_after_last_window_for_testing() == 1
}

func sessionOriginAllowedForTesting(serverURL, frameURL string, mainFrame bool) bool {
	server := C.CString(serverURL)
	frame := C.CString(frameURL)
	defer C.free(unsafe.Pointer(server))
	defer C.free(unsafe.Pointer(frame))
	isMain := C.int(0)
	if mainFrame {
		isMain = 1
	}
	return C.pop_desktop_session_origin_allowed_for_testing(server, frame, isMain) == 1
}
