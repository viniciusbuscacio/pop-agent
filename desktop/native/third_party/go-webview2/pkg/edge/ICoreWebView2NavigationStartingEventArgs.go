package edge

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

type _ICoreWebView2NavigationStartingEventArgsVtbl struct {
	_IUnknownVtbl
	GetURI             ComProc
	GetIsUserInitiated ComProc
	GetIsRedirected    ComProc
	GetRequestHeaders  ComProc
	GetCancel          ComProc
	PutCancel          ComProc
	GetNavigationID    ComProc
}

type ICoreWebView2NavigationStartingEventArgs struct {
	vtbl *_ICoreWebView2NavigationStartingEventArgsVtbl
}

func (i *ICoreWebView2NavigationStartingEventArgs) GetURI() (string, error) {
	var value *uint16
	_, _, err := i.vtbl.GetURI.Call(uintptr(unsafe.Pointer(i)), uintptr(unsafe.Pointer(&value)))
	if err != windows.ERROR_SUCCESS {
		return "", err
	}
	result := windows.UTF16PtrToString(value)
	windows.CoTaskMemFree(unsafe.Pointer(value))
	return result, nil
}
func (i *ICoreWebView2NavigationStartingEventArgs) PutCancel(cancel bool) error {
	_, _, err := i.vtbl.PutCancel.Call(uintptr(unsafe.Pointer(i)), uintptr(boolToInt(cancel)))
	if err != windows.ERROR_SUCCESS {
		return err
	}
	return nil
}
