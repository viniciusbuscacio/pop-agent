//go:build windows

package main

import (
	_ "embed"
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"unsafe"

	webview "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

const desktopTitle = "Pop Agent Desktop"

//go:embed desktop_theme.js
var desktopThemeScript string

func closeDesktopWindow() {
	self, err := os.Executable()
	if err != nil {
		return
	}
	title, _ := windows.UTF16PtrFromString(desktopTitle)
	user32 := windows.NewLazySystemDLL("user32.dll")
	hwnd, _, _ := user32.NewProc("FindWindowW").Call(0, uintptr(unsafe.Pointer(title)))
	if hwnd == 0 {
		return
	}
	var pid uint32
	user32.NewProc("GetWindowThreadProcessId").Call(hwnd, uintptr(unsafe.Pointer(&pid)))
	process, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
	if err != nil {
		return
	}
	defer windows.CloseHandle(process)
	var buffer [32768]uint16
	size := uint32(len(buffer))
	if windows.QueryFullProcessImageName(process, 0, &buffer[0], &size) != nil {
		return
	}
	expected := filepath.Join(filepath.Dir(self), "pop-agent-desktop.exe")
	if strings.EqualFold(filepath.Clean(windows.UTF16ToString(buffer[:size])), filepath.Clean(expected)) {
		user32.NewProc("PostMessageW").Call(hwnd, 0x0010, 0, 0)
	}
}

func openDesktop(server string) error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	target := filepath.Join(filepath.Dir(self), "pop-agent-desktop.exe")
	if _, err := os.Stat(target); os.IsNotExist(err) {
		return openExternal(server)
	}
	cmd := exec.Command(target)
	return cmd.Start()
}

// Desktop is a view-only process. Local operations stay in the existing
// independently authorized tray/runtime; no Go bindings are exposed to pages.
func runDesktopIfRequested() bool {
	self, err := os.Executable()
	if err != nil || !strings.EqualFold(filepath.Base(self), "pop-agent-desktop.exe") {
		return false
	}
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()
	name, _ := windows.UTF16PtrFromString(`Local\PopAgentDesktopWindow`)
	handle, err := windows.CreateMutex(nil, false, name)
	if err != nil && err != windows.ERROR_ALREADY_EXISTS {
		return true
	}
	defer windows.CloseHandle(handle)
	if err == windows.ERROR_ALREADY_EXISTS || windows.GetLastError() == windows.ERROR_ALREADY_EXISTS {
		title, _ := windows.UTF16PtrFromString(desktopTitle)
		user32 := windows.NewLazySystemDLL("user32.dll")
		hwnd, _, _ := user32.NewProc("FindWindowW").Call(0, uintptr(unsafe.Pointer(title)))
		if hwnd != 0 {
			user32.NewProc("ShowWindow").Call(hwnd, 9)
			user32.NewProc("SetForegroundWindow").Call(hwnd)
		}
		return true
	}
	profileFile, err := profilePath()
	if err != nil {
		setupDialog(desktopTitle, "Run Pop Agent Setup to connect to your server.", "OK", false)
		return true
	}
	_, profile, err := readProfiles(profileFile)
	if err != nil {
		setupDialog(desktopTitle, "Run Pop Agent Setup to connect to your server.", "OK", false)
		return true
	}
	origin := safeOrigin(profile.URL)
	tray := exec.Command(filepath.Join(filepath.Dir(self), "pop-local-access.exe"))
	tray.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	if err := tray.Start(); err != nil {
		setupDialog(desktopTitle, "Computer access could not start. Run Pop Agent Setup to repair the installation.", "OK", false)
	}
	dataRoot, err := windows.KnownFolderPath(windows.FOLDERID_LocalAppData, 0)
	if err != nil {
		return true
	}
	var view webview.WebView
	view = webview.NewWithOptions(webview.WebViewOptions{
		DataPath: filepath.Join(dataRoot, "PopAgent", "DesktopWebView"), AutoFocus: true,
		Message: func(message string) {
			if view == nil {
				return
			}
			switch message {
			case "pop-desktop-theme:dark":
				desktopTitleBarTheme(uintptr(view.Window()), true)
			case "pop-desktop-theme:light":
				desktopTitleBarTheme(uintptr(view.Window()), false)
			}
		},
		WindowOptions: webview.WindowOptions{Title: desktopTitle, Width: 1180, Height: 780, Center: true},
		NavigationStarting: func(target string) bool {
			internal, external := desktopNavigation(origin, target)
			if external {
				_ = openExternal(target)
			}
			return internal
		},
		NewWindowRequested: func(target string) {
			internal, external := desktopNavigation(origin, target)
			if internal && view != nil {
				view.Navigate(target)
			} else if external {
				_ = openExternal(target)
			}
		},
	})
	if view == nil {
		setupDialog(desktopTitle, "Microsoft Edge WebView2 Runtime is required. Run Pop Agent Setup to repair the installation.", "OK", false)
		return true
	}
	defer view.Destroy()
	desktopTitleBarTheme(uintptr(view.Window()), true)
	view.Init(desktopThemeScript)
	icon := desktopWindowIcon(uintptr(view.Window()))
	if icon != 0 {
		defer windows.NewLazySystemDLL("user32.dll").NewProc("DestroyIcon").Call(icon)
	}
	view.SetSize(720, 520, webview.HintMin)
	view.Navigate(origin)
	view.Run()
	return true
}

func desktopWindowIcon(hwnd uintptr) uintptr {
	if len(trayIcon) < 22 {
		return 0
	}
	size := int(binary.LittleEndian.Uint32(trayIcon[14:18]))
	offset := int(binary.LittleEndian.Uint32(trayIcon[18:22]))
	if offset < 22 || size <= 0 || offset > len(trayIcon)-size {
		return 0
	}
	user32 := windows.NewLazySystemDLL("user32.dll")
	icon, _, _ := user32.NewProc("CreateIconFromResourceEx").Call(uintptr(unsafe.Pointer(&trayIcon[offset])), uintptr(size), 1, 0x00030000, 32, 32, 0)
	if icon != 0 {
		user32.NewProc("SendMessageW").Call(hwnd, 0x0080, 0, icon)
		user32.NewProc("SendMessageW").Call(hwnd, 0x0080, 1, icon)
	}
	return icon
}

// Mirror the resolved web theme; stay dark until the page reports its theme.
// Unsupported DWM attributes are ignored on older Windows versions.
func desktopTitleBarTheme(hwnd uintptr, dark bool) {
	darkMode, background, foreground := uint32(1), uint32(0x202020), uint32(0xd6d6d6)
	if !dark {
		darkMode, background, foreground = 0, 0xf2f5f7, 0x1e1f20
	}
	setAttribute := windows.NewLazySystemDLL("dwmapi.dll").NewProc("DwmSetWindowAttribute")
	if setAttribute.Find() != nil {
		return
	}
	for _, attribute := range []struct {
		id    uintptr
		value uint32
	}{
		{20, darkMode},   // DWMWA_USE_IMMERSIVE_DARK_MODE
		{35, background}, // DWMWA_CAPTION_COLOR (COLORREF)
		{36, foreground}, // DWMWA_TEXT_COLOR (COLORREF)
	} {
		setAttribute.Call(hwnd, attribute.id, uintptr(unsafe.Pointer(&attribute.value)), unsafe.Sizeof(attribute.value))
	}
}
