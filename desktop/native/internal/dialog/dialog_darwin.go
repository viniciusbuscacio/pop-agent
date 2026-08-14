//go:build darwin

package dialog

/*
#cgo CFLAGS: -fblocks
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
int pop_prompt_server(const char *currentURL, char **serverURL, char **password);
void pop_show_info(const char *title, const char *message);
void pop_show_error(const char *title, const char *message);
*/
import "C"

import "unsafe"

func promptServer(currentURL string) (string, string, bool) {
	current := C.CString(currentURL)
	defer C.free(unsafe.Pointer(current))
	var serverURL *C.char
	var password *C.char
	if C.pop_prompt_server(current, &serverURL, &password) == 0 {
		return "", "", false
	}
	defer C.free(unsafe.Pointer(serverURL))
	defer C.free(unsafe.Pointer(password))
	return C.GoString(serverURL), C.GoString(password), true
}

func showInfo(title, message string)  { show(title, message, false) }
func showError(title, message string) { show(title, message, true) }

func show(title, message string, isError bool) {
	titleValue := C.CString(title)
	messageValue := C.CString(message)
	defer C.free(unsafe.Pointer(titleValue))
	defer C.free(unsafe.Pointer(messageValue))
	if isError {
		C.pop_show_error(titleValue, messageValue)
		return
	}
	C.pop_show_info(titleValue, messageValue)
}
