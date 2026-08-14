//go:build windows

package desktopwindow

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unsafe"

	webview "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

const (
	webViewDataDirectory            = "Pop Desktop WebView2"
	wmSetIcon                       = 0x0080
	iconSmall                       = 0
	iconBig                         = 1
	imageIcon                       = 1
	lrLoadFromFile                  = 0x0010
	lrDefaultSize                   = 0x0040
	mbOK                            = 0
	mbIconError                     = 0x10
	mbSetForeground                 = 0x10000
	swRestore                       = 9
	dwmwaUseImmersiveDarkMode       = 20
	dwmwaUseImmersiveDarkModeLegacy = 19
	dwmwaBorderColor                = 34
	dwmwaCaptionColor               = 35
	dwmwaTextColor                  = 36
)

var (
	darkCaptionColor uint32 = 0x00352c29
	darkBorderColor  uint32 = 0x00564a45
	lightTextColor   uint32 = 0x00ffffff

	user32                = windows.NewLazySystemDLL("user32.dll")
	shell32               = windows.NewLazySystemDLL("shell32.dll")
	dwmapi                = windows.NewLazySystemDLL("dwmapi.dll")
	loadImage             = user32.NewProc("LoadImageW")
	sendMessage           = user32.NewProc("SendMessageW")
	messageBox            = user32.NewProc("MessageBoxW")
	shellExecute          = shell32.NewProc("ShellExecuteW")
	showWindow            = user32.NewProc("ShowWindow")
	setForegroundWindow   = user32.NewProc("SetForegroundWindow")
	dwmSetWindowAttribute = dwmapi.NewProc("DwmSetWindowAttribute")
)

var (
	viewMu      sync.Mutex
	desktopView webview.WebView
)

func install(serverURL string, onSession SessionHandler) error {
	dataPath, err := webViewDataPath()
	if err != nil {
		return err
	}
	var candidate webview.WebView
	candidate = webview.NewWithOptions(webview.WebViewOptions{
		Debug: false, DataPath: dataPath, AutoFocus: true,
		NavigationStarting: func(target string) bool {
			switch navigationPolicy(serverURL, target) {
			case navigationInternal:
				return true
			case navigationExternal:
				openExternal(target)
			}
			return false
		},
		NewWindowRequested: func(target string) {
			switch navigationPolicy(serverURL, target) {
			case navigationInternal:
				candidate.Navigate(target)
			case navigationExternal:
				openExternal(target)
			}
		},
		WindowOptions: webview.WindowOptions{Title: "Pop Desktop", Width: 1180, Height: 780, Center: true},
	})
	if candidate == nil {
		return fmt.Errorf("Microsoft Edge WebView2 Runtime is required")
	}
	candidate.SetSize(720, 520, webview.HintMin)
	window := uintptr(candidate.Window())
	applyDarkTitleBar(window)
	setWindowIcon(window)
	installSessionBridge(candidate, serverURL, onSession)
	candidate.Navigate(serverURL)
	viewMu.Lock()
	desktopView = candidate
	viewMu.Unlock()
	return nil
}

func setServerURL(serverURL string) {
	viewMu.Lock()
	view := desktopView
	viewMu.Unlock()
	if view != nil {
		view.Dispatch(func() { view.Navigate(serverURL) })
	}
}
func show() {
	viewMu.Lock()
	view := desktopView
	viewMu.Unlock()
	if view != nil {
		hwnd := uintptr(view.Window())
		showWindow.Call(hwnd, swRestore)
		setForegroundWindow.Call(hwnd)
	}
}
func run() {
	viewMu.Lock()
	view := desktopView
	viewMu.Unlock()
	if view != nil {
		view.Run()
	}
}
func stop() {
	viewMu.Lock()
	view := desktopView
	viewMu.Unlock()
	if view != nil {
		view.Terminate()
	}
}
func remove() {
	viewMu.Lock()
	view := desktopView
	desktopView = nil
	viewMu.Unlock()
	if view != nil {
		view.Destroy()
	}
}

func webViewDataPath() (string, error) {
	root := os.Getenv("LOCALAPPDATA")
	if root == "" {
		return "", os.ErrNotExist
	}
	path := filepath.Join(root, "Pop Agent", webViewDataDirectory)
	if err := os.MkdirAll(path, 0o700); err != nil {
		return "", err
	}
	return path, nil
}

func installSessionBridge(view webview.WebView, serverURL string, onSession SessionHandler) {
	_ = view.Bind("__popDesktopSession", func(token string) {
		if len(token) <= 12*1024 {
			onSession(token)
		}
	})
	origin := strings.TrimRight(serverURL, "/")
	originJSON, _ := json.Marshal(origin)
	// The PWA already writes to webkit.messageHandlers.popSession on macOS.
	// Provide the same narrow surface on Windows; no filesystem, shell, or
	// other native capability is exposed.
	view.Init(`(() => {
  const allowedOrigin = ` + string(originJSON) + `;
  const nativeUserAgent = navigator.userAgent;
  try { Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => nativeUserAgent + ' PopDesktop/0.2.18' }); } catch (_) {}
  const send = message => {
    if (location.origin !== allowedOrigin || !message || message.kind !== 'session' || typeof message.token !== 'string') return;
    window.__popDesktopSession(message.token);
  };
  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = window.webkit.messageHandlers || {};
  window.webkit.messageHandlers.popSession = { postMessage: send };
})();`)
}

func openExternal(target string) {
	verb, _ := windows.UTF16PtrFromString("open")
	value, _ := windows.UTF16PtrFromString(target)
	shellExecute.Call(0, uintptr(unsafe.Pointer(verb)), uintptr(unsafe.Pointer(value)), 0, 0, 1)
}

func applyDarkTitleBar(window uintptr) {
	enabled := int32(1)
	result, _, _ := dwmSetWindowAttribute.Call(window, dwmwaUseImmersiveDarkMode, uintptr(unsafe.Pointer(&enabled)), unsafe.Sizeof(enabled))
	if int32(result) < 0 {
		dwmSetWindowAttribute.Call(window, dwmwaUseImmersiveDarkModeLegacy, uintptr(unsafe.Pointer(&enabled)), unsafe.Sizeof(enabled))
	}
	for attribute, color := range map[uintptr]*uint32{
		dwmwaBorderColor: &darkBorderColor, dwmwaCaptionColor: &darkCaptionColor, dwmwaTextColor: &lightTextColor,
	} {
		dwmSetWindowAttribute.Call(window, attribute, uintptr(unsafe.Pointer(color)), unsafe.Sizeof(*color))
	}
}

func setWindowIcon(window uintptr) {
	executable, err := os.Executable()
	if err != nil {
		return
	}
	iconPath := filepath.Join(filepath.Dir(executable), "Pop Desktop.ico")
	if _, err := os.Stat(iconPath); err != nil {
		return
	}
	value, _ := windows.UTF16PtrFromString(iconPath)
	icon, _, _ := loadImage.Call(0, uintptr(unsafe.Pointer(value)), imageIcon, 0, 0, lrLoadFromFile|lrDefaultSize)
	if icon == 0 {
		return
	}
	sendMessage.Call(window, wmSetIcon, iconSmall, icon)
	sendMessage.Call(window, wmSetIcon, iconBig, icon)
}

func showFatal(message string) {
	title, _ := windows.UTF16PtrFromString("Pop Desktop")
	text, _ := windows.UTF16PtrFromString(message)
	messageBox.Call(0, uintptr(unsafe.Pointer(text)), uintptr(unsafe.Pointer(title)), mbOK|mbIconError|mbSetForeground)
}
