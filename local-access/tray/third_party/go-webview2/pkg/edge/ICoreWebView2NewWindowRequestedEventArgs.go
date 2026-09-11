package edge

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

type _ICoreWebView2NewWindowRequestedEventArgsVtbl struct {
	_IUnknownVtbl
	GetURI             ComProc
	PutNewWindow       ComProc
	GetNewWindow       ComProc
	PutHandled         ComProc
	GetHandled         ComProc
	GetIsUserInitiated ComProc
	GetDeferral        ComProc
	GetWindowFeatures  ComProc
}

type ICoreWebView2NewWindowRequestedEventArgs struct {
	vtbl *_ICoreWebView2NewWindowRequestedEventArgsVtbl
}

func (i *ICoreWebView2NewWindowRequestedEventArgs) GetURI() (string, error) {
	var value *uint16
	_, _, err := i.vtbl.GetURI.Call(uintptr(unsafe.Pointer(i)), uintptr(unsafe.Pointer(&value)))
	if err != windows.ERROR_SUCCESS {
		return "", err
	}
	result := windows.UTF16PtrToString(value)
	windows.CoTaskMemFree(unsafe.Pointer(value))
	return result, nil
}
func (i *ICoreWebView2NewWindowRequestedEventArgs) PutHandled(handled bool) error {
	_, _, err := i.vtbl.PutHandled.Call(uintptr(unsafe.Pointer(i)), uintptr(boolToInt(handled)))
	if err != windows.ERROR_SUCCESS {
		return err
	}
	return nil
}
