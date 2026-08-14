//go:build darwin

package tray

/*
#cgo CFLAGS: -fblocks
#cgo LDFLAGS: -framework Cocoa
#include <stddef.h>
#include <stdlib.h>
int pop_install_tray(const void *iconBytes, size_t iconLength);
void pop_update_tray(const char *server, const char *serverDetail, const char *serverURL, int serverIndicator,
    const char *desktop, const char *desktopDetail, const char *desktopVersion, const char *desktopPath, int desktopIndicator,
    const char *cli, const char *cliDetail, const char *cliVersion, const char *cliPath, const char *cliNodePath, int cliIndicator,
    const char *node, const char *nodeDetail, const char *nodeVersion, const char *nodePath, int nodeIndicator,
    int openDesktopEnabled, int checkDesktopEnabled, int installDesktopEnabled, const char *desktopActionTitle,
    int checkUpdatesEnabled, int checkServerEnabled, int checkNodeEnabled, int checkCLIEnabled, int updateCLIEnabled, const char *cliActionTitle, int configureServerEnabled, int startAtLogin, int startAtLoginEnabled);
void pop_remove_tray(void);
void pop_run_application(void);
void pop_stop_application(void);
*/
import "C"

import (
	_ "embed"
	"errors"
	"sync"
	"unsafe"
)

//go:embed trayTemplate.png
var trayIcon []byte

var (
	callbacksMu sync.RWMutex
	callbacks   Callbacks
)

func Install(next Callbacks) error {
	if next.Quit == nil {
		return errors.New("tray Quit callback must be configured")
	}
	if len(trayIcon) == 0 {
		return errors.New("tray icon is empty")
	}
	callbacksMu.Lock()
	callbacks = next
	callbacksMu.Unlock()
	if C.pop_install_tray(unsafe.Pointer(&trayIcon[0]), C.size_t(len(trayIcon))) == 0 {
		return errors.New("AppKit did not create the status item")
	}
	return nil
}

func Update(state MenuState) {
	server := C.CString(state.Server)
	serverDetail := C.CString(state.ServerDetail)
	serverURL := C.CString(state.ServerURL)
	desktop := C.CString(state.Desktop)
	desktopDetail := C.CString(state.DesktopDetail)
	desktopVersion := C.CString(state.DesktopVersion)
	desktopPath := C.CString(state.DesktopPath)
	desktopActionTitle := C.CString(state.DesktopActionTitle)
	cli := C.CString(state.CLI)
	cliDetail := C.CString(state.CLIDetail)
	cliVersion := C.CString(state.CLIVersion)
	cliPath := C.CString(state.CLIPath)
	cliNodePath := C.CString(state.CLINodePath)
	node := C.CString(state.Node)
	nodeDetail := C.CString(state.NodeDetail)
	nodeVersion := C.CString(state.NodeVersion)
	nodePath := C.CString(state.NodePath)
	cliActionTitle := C.CString(state.CLIActionTitle)
	defer C.free(unsafe.Pointer(server))
	defer C.free(unsafe.Pointer(serverDetail))
	defer C.free(unsafe.Pointer(serverURL))
	defer C.free(unsafe.Pointer(desktop))
	defer C.free(unsafe.Pointer(desktopDetail))
	defer C.free(unsafe.Pointer(desktopVersion))
	defer C.free(unsafe.Pointer(desktopPath))
	defer C.free(unsafe.Pointer(desktopActionTitle))
	defer C.free(unsafe.Pointer(cli))
	defer C.free(unsafe.Pointer(cliDetail))
	defer C.free(unsafe.Pointer(cliVersion))
	defer C.free(unsafe.Pointer(cliPath))
	defer C.free(unsafe.Pointer(cliNodePath))
	defer C.free(unsafe.Pointer(node))
	defer C.free(unsafe.Pointer(nodeDetail))
	defer C.free(unsafe.Pointer(nodeVersion))
	defer C.free(unsafe.Pointer(nodePath))
	defer C.free(unsafe.Pointer(cliActionTitle))
	C.pop_update_tray(
		server, serverDetail, serverURL, C.int(state.ServerIndicator),
		desktop, desktopDetail, desktopVersion, desktopPath, C.int(state.DesktopIndicator),
		cli, cliDetail, cliVersion, cliPath, cliNodePath, C.int(state.CLIIndicator),
		node, nodeDetail, nodeVersion, nodePath, C.int(state.NodeIndicator),
		boolInt(state.OpenDesktopEnabled), boolInt(state.CheckDesktopEnabled), boolInt(state.InstallDesktopEnabled), desktopActionTitle,
		boolInt(state.CheckUpdatesEnabled), boolInt(state.CheckServerEnabled), boolInt(state.CheckNodeEnabled), boolInt(state.CheckCLIEnabled), boolInt(state.UpdateCLIEnabled), cliActionTitle, boolInt(state.ConfigureServerEnabled),
		boolInt(state.StartAtLogin), boolInt(state.StartAtLoginEnabled),
	)
}

func Run()    { C.pop_run_application() }
func Stop()   { C.pop_stop_application() }
func Remove() { C.pop_remove_tray() }

func boolInt(value bool) C.int {
	if value {
		return 1
	}
	return 0
}

func callback(selectFn func(Callbacks) func()) {
	callbacksMu.RLock()
	fn := selectFn(callbacks)
	callbacksMu.RUnlock()
	if fn != nil {
		fn()
	}
}

//export popTrayOpenDesktop
func popTrayOpenDesktop() { callback(func(value Callbacks) func() { return value.OpenDesktop }) }

//export popTrayCheckDesktop
func popTrayCheckDesktop() { callback(func(value Callbacks) func() { return value.CheckDesktop }) }

//export popTrayInstallDesktop
func popTrayInstallDesktop() { callback(func(value Callbacks) func() { return value.InstallDesktop }) }

//export popTrayCheckUpdates
func popTrayCheckUpdates() { callback(func(value Callbacks) func() { return value.CheckUpdates }) }

//export popTrayCheckServer
func popTrayCheckServer() { callback(func(value Callbacks) func() { return value.CheckServer }) }

//export popTrayCheckNode
func popTrayCheckNode() { callback(func(value Callbacks) func() { return value.CheckNode }) }

//export popTrayCheckCLI
func popTrayCheckCLI() { callback(func(value Callbacks) func() { return value.CheckCLI }) }

//export popTrayUpdateCLI
func popTrayUpdateCLI() { callback(func(value Callbacks) func() { return value.UpdateCLI }) }

//export popTrayConfigureServer
func popTrayConfigureServer() {
	callback(func(value Callbacks) func() { return value.ConfigureServer })
}

//export popTrayDiagnostics
func popTrayDiagnostics() { callback(func(value Callbacks) func() { return value.Diagnostics }) }

//export popTrayToggleStartAtLogin
func popTrayToggleStartAtLogin() {
	callback(func(value Callbacks) func() { return value.ToggleStartAtLogin })
}

//export popTrayQuit
func popTrayQuit() { callback(func(value Callbacks) func() { return value.Quit }) }
