package edge

type _ICoreWebView2NewWindowRequestedEventHandlerVtbl struct {
	_IUnknownVtbl
	Invoke ComProc
}

type ICoreWebView2NewWindowRequestedEventHandler struct {
	vtbl *_ICoreWebView2NewWindowRequestedEventHandlerVtbl
	impl _ICoreWebView2NewWindowRequestedEventHandlerImpl
}

type _ICoreWebView2NewWindowRequestedEventHandlerImpl interface {
	_IUnknownImpl
	NewWindowRequested(sender *ICoreWebView2, args *ICoreWebView2NewWindowRequestedEventArgs) uintptr
}

func newWindowQuery(this *ICoreWebView2NewWindowRequestedEventHandler, refiid, object uintptr) uintptr {
	return this.impl.QueryInterface(refiid, object)
}
func newWindowAddRef(this *ICoreWebView2NewWindowRequestedEventHandler) uintptr {
	return this.impl.AddRef()
}
func newWindowRelease(this *ICoreWebView2NewWindowRequestedEventHandler) uintptr {
	return this.impl.Release()
}
func newWindowInvoke(this *ICoreWebView2NewWindowRequestedEventHandler, sender *ICoreWebView2, args *ICoreWebView2NewWindowRequestedEventArgs) uintptr {
	return this.impl.NewWindowRequested(sender, args)
}

var newWindowVtbl = _ICoreWebView2NewWindowRequestedEventHandlerVtbl{
	_IUnknownVtbl{NewComProc(newWindowQuery), NewComProc(newWindowAddRef), NewComProc(newWindowRelease)},
	NewComProc(newWindowInvoke),
}

func newICoreWebView2NewWindowRequestedEventHandler(impl _ICoreWebView2NewWindowRequestedEventHandlerImpl) *ICoreWebView2NewWindowRequestedEventHandler {
	return &ICoreWebView2NewWindowRequestedEventHandler{vtbl: &newWindowVtbl, impl: impl}
}
