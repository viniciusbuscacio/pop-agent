package desktopwindow

// SessionHandler receives only the PWA's current bearer session. The native
// bridge intentionally exposes no filesystem or command surface to web code.
type SessionHandler func(token string)

// Install adds the Pop Desktop window to the current native application. It
// does not start a second event loop, allowing the window and tray to coexist.
func Install(serverURL string, onSession SessionHandler) error { return install(serverURL, "", onSession) }

// InstallWithSession seeds the PWA's same-origin storage before its first
// document loads. Setup uses this once so the user does not sign in twice.
func InstallWithSession(serverURL, token string, onSession SessionHandler) error {
	return install(serverURL, token, onSession)
}

// SetServerURL changes the origin loaded by the native host after configuration.
func SetServerURL(serverURL string) { setServerURL(serverURL) }

// Show opens or raises the existing Pop Desktop window.
func Show() { show() }

// Run owns the current native application's event loop until Stop is called.
func Run() { run() }

// Stop terminates the current native event loop. Remove releases native state.
func Stop()   { stop() }
func Remove() { remove() }

// ShowFatal presents a short native launch error without starting the web view.
func ShowFatal(message string) { showFatal(message) }
