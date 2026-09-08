//go:build darwin

package main

/*
#cgo CFLAGS: -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
char *popPromptPassword(const char *server);
void popShowSignInError(const char *message);
*/
import "C"
import "unsafe"

const nativeSignInAvailable = true

func promptPassword(server string) (string, bool) {
	s := C.CString(server)
	defer C.free(unsafe.Pointer(s))
	result := C.popPromptPassword(s)
	if result == nil {
		return "", false
	}
	defer C.free(unsafe.Pointer(result))
	return C.GoString(result), true
}

func showSignInError(message string) {
	s := C.CString(message)
	defer C.free(unsafe.Pointer(s))
	C.popShowSignInError(s)
}
