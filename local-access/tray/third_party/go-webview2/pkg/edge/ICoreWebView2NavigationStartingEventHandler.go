package edge

type _ICoreWebView2NavigationStartingEventHandlerVtbl struct {
	_IUnknownVtbl
	Invoke ComProc
}

type ICoreWebView2NavigationStartingEventHandler struct {
	vtbl *_ICoreWebView2NavigationStartingEventHandlerVtbl
	impl _ICoreWebView2NavigationStartingEventHandlerImpl
}

type _ICoreWebView2NavigationStartingEventHandlerImpl interface {
	_IUnknownImpl
	NavigationStarting(sender *ICoreWebView2, args *ICoreWebView2NavigationStartingEventArgs) uintptr
}

func navigationStartingQuery(this *ICoreWebView2NavigationStartingEventHandler, refiid, object uintptr) uintptr {
	return this.impl.QueryInterface(refiid, object)
}
func navigationStartingAddRef(this *ICoreWebView2NavigationStartingEventHandler) uintptr {
	return this.impl.AddRef()
}
func navigationStartingRelease(this *ICoreWebView2NavigationStartingEventHandler) uintptr {
	return this.impl.Release()
}
func navigationStartingInvoke(this *ICoreWebView2NavigationStartingEventHandler, sender *ICoreWebView2, args *ICoreWebView2NavigationStartingEventArgs) uintptr {
	return this.impl.NavigationStarting(sender, args)
}

var navigationStartingVtbl = _ICoreWebView2NavigationStartingEventHandlerVtbl{
	_IUnknownVtbl{NewComProc(navigationStartingQuery), NewComProc(navigationStartingAddRef), NewComProc(navigationStartingRelease)},
	NewComProc(navigationStartingInvoke),
}

func newICoreWebView2NavigationStartingEventHandler(impl _ICoreWebView2NavigationStartingEventHandlerImpl) *ICoreWebView2NavigationStartingEventHandler {
	return &ICoreWebView2NavigationStartingEventHandler{vtbl: &navigationStartingVtbl, impl: impl}
}
