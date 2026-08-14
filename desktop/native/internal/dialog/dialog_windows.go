//go:build windows

package dialog

import (
	"runtime"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

const (
	windowClassName = "PopAgentServerDialog"
	idServerURL     = 1001
	idPassword      = 1002
	idConnect       = 1
	idCancel        = 2

	wmClose           = 0x0010
	wmDestroy         = 0x0002
	wmCommand         = 0x0111
	wmSetFont         = 0x0030
	wsOverlapped      = 0x00000000
	wsCaption         = 0x00C00000
	wsSysMenu         = 0x00080000
	wsVisible         = 0x10000000
	wsChild           = 0x40000000
	wsTabStop         = 0x00010000
	wsBorder          = 0x00800000
	esAutoHScroll     = 0x0080
	esPassword        = 0x0020
	bsDefPushButton   = 0x0001
	swShow            = 5
	colorWindow       = 5
	defaultGUIFont    = 17
	mbOK              = 0x0
	mbYesNo           = 0x4
	idYes             = 6
	mbIconError       = 0x10
	mbIconInformation = 0x40
	mbSetForeground   = 0x10000
	smCXScreen        = 0
	smCYScreen        = 1
)

type point struct{ X, Y int32 }
type message struct {
	Window  windows.Handle
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Point   point
}
type windowClass struct {
	Size        uint32
	Style       uint32
	WndProc     uintptr
	ClassExtra  int32
	WindowExtra int32
	Instance    windows.Handle
	Icon        windows.Handle
	Cursor      windows.Handle
	Background  windows.Handle
	MenuName    *uint16
	ClassName   *uint16
	SmallIcon   windows.Handle
}
type serverDialog struct {
	serverEdit     windows.Handle
	passwordEdit   windows.Handle
	serverURL      string
	password       []uint16
	passwordLength int
	accepted       bool
}

var (
	user32              = windows.NewLazySystemDLL("user32.dll")
	kernel32            = windows.NewLazySystemDLL("kernel32.dll")
	createWindowEx      = user32.NewProc("CreateWindowExW")
	defWindowProc       = user32.NewProc("DefWindowProcW")
	destroyWindow       = user32.NewProc("DestroyWindow")
	dispatchMessage     = user32.NewProc("DispatchMessageW")
	getMessage          = user32.NewProc("GetMessageW")
	getStockObject      = windows.NewLazySystemDLL("gdi32.dll").NewProc("GetStockObject")
	getSystemMetrics    = user32.NewProc("GetSystemMetrics")
	getWindowText       = user32.NewProc("GetWindowTextW")
	getWindowTextLength = user32.NewProc("GetWindowTextLengthW")
	getModuleHandle     = kernel32.NewProc("GetModuleHandleW")
	loadCursor          = user32.NewProc("LoadCursorW")
	messageBox          = user32.NewProc("MessageBoxW")
	postQuitMessage     = user32.NewProc("PostQuitMessage")
	registerClass       = user32.NewProc("RegisterClassExW")
	sendMessage         = user32.NewProc("SendMessageW")
	setFocus            = user32.NewProc("SetFocus")
	showWindow          = user32.NewProc("ShowWindow")
	translateMessage    = user32.NewProc("TranslateMessage")
	windowProcCallback  = syscall.NewCallback(serverDialogWindowProc)
	activeDialog        *serverDialog
)

func promptServer(currentURL string) (string, string, bool) {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	dialog := &serverDialog{}
	activeDialog = dialog
	defer func() { activeDialog = nil }()

	instance, _, _ := getModuleHandle.Call(0)
	className := utf16(windowClassName)
	cursor, _, _ := loadCursor.Call(0, 32512)
	class := windowClass{
		Size: uint32(unsafe.Sizeof(windowClass{})), WndProc: windowProcCallback,
		Instance: windows.Handle(instance), Cursor: windows.Handle(cursor),
		Background: windows.Handle(colorWindow + 1), ClassName: className,
	}
	registerClass.Call(uintptr(unsafe.Pointer(&class)))

	const width, height = 470, 250
	x, _, _ := getSystemMetrics.Call(smCXScreen)
	y, _, _ := getSystemMetrics.Call(smCYScreen)
	hwnd, _, _ := createWindowEx.Call(
		0, uintptr(unsafe.Pointer(className)), uintptr(unsafe.Pointer(utf16("Connect to Pop Agent"))),
		wsOverlapped|wsCaption|wsSysMenu, (x-width)/2, (y-height)/2, width, height,
		0, 0, instance, 0,
	)
	if hwnd == 0 {
		showError("Could not open sign in", "Windows could not create the Pop Agent connection dialog.")
		return "", "", false
	}

	font, _, _ := getStockObject.Call(defaultGUIFont)
	createLabel(hwnd, instance, "Server URL", 28, 25, 400, 20, font)
	dialog.serverEdit = createControl(hwnd, instance, "EDIT", currentURL, wsChild|wsVisible|wsTabStop|wsBorder|esAutoHScroll, 28, 48, 400, 25, idServerURL, font)
	createLabel(hwnd, instance, "Password", 28, 85, 400, 20, font)
	dialog.passwordEdit = createControl(hwnd, instance, "EDIT", "", wsChild|wsVisible|wsTabStop|wsBorder|esAutoHScroll|esPassword, 28, 108, 400, 25, idPassword, font)
	createControl(hwnd, instance, "BUTTON", "Cancel", wsChild|wsVisible|wsTabStop, 260, 160, 80, 28, idCancel, font)
	createControl(hwnd, instance, "BUTTON", "Connect", wsChild|wsVisible|wsTabStop|bsDefPushButton, 348, 160, 80, 28, idConnect, font)

	showWindow.Call(hwnd, swShow)
	if currentURL == "" {
		setFocus.Call(uintptr(dialog.serverEdit))
	} else {
		setFocus.Call(uintptr(dialog.passwordEdit))
	}

	var msg message
	for {
		result, _, _ := getMessage.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
		if int32(result) <= 0 {
			break
		}
		translateMessage.Call(uintptr(unsafe.Pointer(&msg)))
		dispatchMessage.Call(uintptr(unsafe.Pointer(&msg)))
	}
	if !dialog.accepted {
		return "", "", false
	}
	password := syscall.UTF16ToString(dialog.password[:dialog.passwordLength])
	zeroUTF16(dialog.password)
	return dialog.serverURL, password, true
}

func serverDialogWindowProc(hwnd uintptr, msg uint32, wParam, lParam uintptr) uintptr {
	switch msg {
	case wmCommand:
		id := uint16(wParam & 0xffff)
		if activeDialog != nil && id == idConnect {
			activeDialog.serverURL = windowText(activeDialog.serverEdit)
			activeDialog.password, activeDialog.passwordLength = windowTextUTF16(activeDialog.passwordEdit)
			activeDialog.accepted = true
			destroyWindow.Call(hwnd)
			return 0
		}
		if id == idCancel {
			destroyWindow.Call(hwnd)
			return 0
		}
	case wmClose:
		destroyWindow.Call(hwnd)
		return 0
	case wmDestroy:
		postQuitMessage.Call(0)
		return 0
	}
	result, _, _ := defWindowProc.Call(hwnd, uintptr(msg), wParam, lParam)
	return result
}

func createLabel(parent, instance uintptr, text string, x, y, width, height int, font uintptr) {
	createControl(parent, instance, "STATIC", text, wsChild|wsVisible, x, y, width, height, 0, font)
}

func createControl(parent, instance uintptr, class, text string, style uintptr, x, y, width, height, id int, font uintptr) windows.Handle {
	handle, _, _ := createWindowEx.Call(0, uintptr(unsafe.Pointer(utf16(class))), uintptr(unsafe.Pointer(utf16(text))), style,
		uintptr(x), uintptr(y), uintptr(width), uintptr(height), parent, uintptr(id), instance, 0)
	if handle != 0 {
		sendMessage.Call(handle, wmSetFont, font, 1)
	}
	return windows.Handle(handle)
}

func windowText(handle windows.Handle) string {
	buffer, length := windowTextUTF16(handle)
	return syscall.UTF16ToString(buffer[:length])
}

func windowTextUTF16(handle windows.Handle) ([]uint16, int) {
	length, _, _ := getWindowTextLength.Call(uintptr(handle))
	buffer := make([]uint16, length+1)
	getWindowText.Call(uintptr(handle), uintptr(unsafe.Pointer(&buffer[0])), length+1)
	return buffer, int(length)
}

func zeroUTF16(value []uint16) {
	for index := range value {
		value[index] = 0
	}
}

func utf16(value string) *uint16 {
	result, _ := windows.UTF16PtrFromString(value)
	return result
}

func confirm(title, message, acceptTitle string) bool {
	_ = acceptTitle
	result, _, _ := messageBox.Call(0, uintptr(unsafe.Pointer(utf16(message))), uintptr(unsafe.Pointer(utf16(title))), mbYesNo|mbSetForeground)
	return result == idYes
}

func showInfo(title, message string)  { showMessage(title, message, mbIconInformation) }
func showError(title, message string) { showMessage(title, message, mbIconError) }

func showMessage(title, message string, icon uintptr) {
	titleValue := utf16(title)
	messageValue := utf16(message)
	messageBox.Call(0, uintptr(unsafe.Pointer(messageValue)), uintptr(unsafe.Pointer(titleValue)), mbOK|icon|mbSetForeground)
}
