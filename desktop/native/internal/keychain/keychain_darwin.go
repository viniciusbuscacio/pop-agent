//go:build darwin

package keychain

/*
#cgo LDFLAGS: -framework Foundation -framework Security
#include <stdlib.h>
int pop_keychain_get(const char *service, const char *account, char **value);
int pop_keychain_set(const char *service, const char *account, const char *value);
int pop_keychain_delete(const char *service, const char *account);
*/
import "C"

import (
	"errors"
	"fmt"
	"unsafe"
)

const errSecItemNotFound = -25300

type platformStore struct{}

func newPlatformStore() Store { return platformStore{} }

func (store platformStore) Get(account string) (string, error) {
	value, err := store.get(Service, account)
	if !errors.Is(err, ErrNotFound) {
		return value, err
	}

	// Preserve existing sessions while the Manager becomes part of Pop Desktop.
	// The oldest Wails service remains a second fallback for pre-tray builds.
	for _, legacyService := range []string{legacyManagerService, legacyWailsService} {
		legacyValue, legacyErr := store.get(legacyService, account)
		if errors.Is(legacyErr, ErrNotFound) {
			continue
		}
		if legacyErr != nil {
			return "", legacyErr
		}
		if err := store.set(Service, account, legacyValue); err != nil {
			return "", err
		}
		_ = store.delete(legacyService, account)
		return legacyValue, nil
	}
	return "", ErrNotFound
}

func (store platformStore) Set(account, token string) error {
	if account == "" || token == "" {
		return errors.New("Keychain account and token must not be empty")
	}
	return store.set(Service, account, token)
}

func (store platformStore) Delete(account string) error {
	for _, service := range []string{Service, legacyManagerService, legacyWailsService} {
		if err := store.delete(service, account); err != nil {
			return err
		}
	}
	return nil
}

func (platformStore) get(serviceName, account string) (string, error) {
	service := C.CString(serviceName)
	key := C.CString(account)
	defer C.free(unsafe.Pointer(service))
	defer C.free(unsafe.Pointer(key))
	var value *C.char
	status := int(C.pop_keychain_get(service, key, &value))
	if status == errSecItemNotFound {
		return "", ErrNotFound
	}
	if status != 0 {
		return "", fmt.Errorf("read session from Keychain (status %d)", status)
	}
	defer C.free(unsafe.Pointer(value))
	return C.GoString(value), nil
}

func (platformStore) set(serviceName, account, token string) error {
	service := C.CString(serviceName)
	key := C.CString(account)
	value := C.CString(token)
	defer C.free(unsafe.Pointer(service))
	defer C.free(unsafe.Pointer(key))
	defer C.free(unsafe.Pointer(value))
	if status := int(C.pop_keychain_set(service, key, value)); status != 0 {
		return fmt.Errorf("store session in Keychain (status %d)", status)
	}
	return nil
}

func (platformStore) delete(serviceName, account string) error {
	service := C.CString(serviceName)
	key := C.CString(account)
	defer C.free(unsafe.Pointer(service))
	defer C.free(unsafe.Pointer(key))
	status := int(C.pop_keychain_delete(service, key))
	if status != 0 && status != errSecItemNotFound {
		return fmt.Errorf("delete session from Keychain (status %d)", status)
	}
	return nil
}
