//go:build darwin

package loginitem

/*
#cgo CFLAGS: -fblocks
#cgo LDFLAGS: -framework Foundation -framework ServiceManagement
#include <stdlib.h>
int pop_login_item_enabled(void);
int pop_set_login_item_enabled(int enabled, char **errorMessage);
*/
import "C"

import (
	"errors"
	"unsafe"
)

func enabled() (bool, error) { return C.pop_login_item_enabled() != 0, nil }

func setEnabled(value bool) error {
	var message *C.char
	result := C.pop_set_login_item_enabled(boolInt(value), &message)
	if message != nil {
		defer C.free(unsafe.Pointer(message))
	}
	if result == 0 {
		if message == nil {
			return errors.New("macOS did not update the Login Item")
		}
		return errors.New(C.GoString(message))
	}
	return nil
}

func boolInt(value bool) C.int {
	if value {
		return 1
	}
	return 0
}
