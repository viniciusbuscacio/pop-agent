//go:build darwin

package setupui

/*
#cgo LDFLAGS: -framework Cocoa
#include <stdlib.h>
int pop_setup_welcome(void);
int pop_setup_credentials(const char *initialURL, char **serverURL, char **password);
void pop_setup_begin_progress(void);
void pop_setup_run_progress(void);
void pop_setup_set_progress(const char *message);
void pop_setup_finish_progress(void);
void pop_setup_show_error(const char *message);
int pop_setup_show_success(void);
int pop_setup_paste_menu_ready_for_testing(void);
*/
import "C"

import "unsafe"

func welcome() bool { return C.pop_setup_welcome() == 1 }

func askCredentials(initialURL string) (Credentials, bool) {
	value := C.CString(initialURL)
	defer C.free(unsafe.Pointer(value))
	var serverURL *C.char
	var password *C.char
	if C.pop_setup_credentials(value, &serverURL, &password) != 1 {
		return Credentials{}, false
	}
	defer C.free(unsafe.Pointer(serverURL))
	defer C.free(unsafe.Pointer(password))
	return Credentials{ServerURL: C.GoString(serverURL), Password: C.GoString(password)}, true
}

func beginProgress()  { C.pop_setup_begin_progress() }
func runProgress()    { C.pop_setup_run_progress() }
func finishProgress() { C.pop_setup_finish_progress() }

func setProgress(message string) {
	value := C.CString(message)
	defer C.free(unsafe.Pointer(value))
	C.pop_setup_set_progress(value)
}

func showError(message string) {
	value := C.CString(message)
	defer C.free(unsafe.Pointer(value))
	C.pop_setup_show_error(value)
}

func showSuccess() bool { return C.pop_setup_show_success() == 1 }

func pasteMenuReadyForTesting() bool { return C.pop_setup_paste_menu_ready_for_testing() == 1 }
