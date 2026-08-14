//go:build windows

package tray

import (
	_ "embed"
	"errors"
	"sync"

	"github.com/getlantern/systray"
)

//go:embed tray_windows.ico
var trayIcon []byte

//go:embed status_neutral_windows.ico
var neutralStatusIcon []byte

//go:embed status_good_windows.ico
var goodStatusIcon []byte

//go:embed status_warning_windows.ico
var warningStatusIcon []byte

//go:embed status_bad_windows.ico
var badStatusIcon []byte

type windowsMenu struct {
	server, desktop, cli, node                      *systray.MenuItem
	serverDetail, serverURL, checkServer, configure *systray.MenuItem
	desktopDetail, desktopVersion, desktopPath      *systray.MenuItem
	checkDesktop, desktopAction, openDesktop        *systray.MenuItem
	cliDetail, cliVersion, cliPath, cliNodePath     *systray.MenuItem
	checkCLI, cliAction                             *systray.MenuItem
	nodeDetail, nodeVersion, nodePath, checkNode    *systray.MenuItem
	checkUpdates, diagnostics, startAtLogin, quit   *systray.MenuItem
}

var windowsTray = struct {
	sync.Mutex
	callbacks Callbacks
	state     MenuState
	ready     bool
	menu      windowsMenu
}{}

func Install(callbacks Callbacks) error {
	if callbacks.Quit == nil {
		return errors.New("tray Quit callback must be configured")
	}
	if len(trayIcon) == 0 {
		return errors.New("tray icon is empty")
	}
	windowsTray.Lock()
	windowsTray.callbacks = callbacks
	windowsTray.Unlock()
	return nil
}

func Update(state MenuState) {
	windowsTray.Lock()
	windowsTray.state = state
	if windowsTray.ready {
		applyWindowsState(windowsTray.menu, state)
	}
	windowsTray.Unlock()
}

func Run() {
	systray.Run(func() {
		systray.SetIcon(trayIcon)
		systray.SetTooltip("Pop Desktop")
		menu := buildWindowsMenu()
		windowsTray.Lock()
		windowsTray.menu = menu
		windowsTray.ready = true
		state := windowsTray.state
		windowsTray.Unlock()
		applyWindowsState(menu, state)
	}, func() {
		windowsTray.Lock()
		windowsTray.ready = false
		windowsTray.Unlock()
	})
}

func Stop()   { systray.Quit() }
func Remove() { systray.Quit() }

func buildWindowsMenu() windowsMenu {
	heading := systray.AddMenuItem("Pop Desktop", "")
	heading.Disable()
	systray.AddSeparator()

	m := windowsMenu{}
	m.server = systray.AddMenuItem("Server", "Server status")
	m.serverDetail = m.server.AddSubMenuItem("Status", "")
	m.serverDetail.Disable()
	m.serverURL = m.server.AddSubMenuItem("URL", "")
	m.serverURL.Disable()
	m.checkServer = m.server.AddSubMenuItem("Check Connection", "Check the server session")
	m.configure = m.server.AddSubMenuItem("Configure Server…", "Set server URL and sign in")

	m.desktop = systray.AddMenuItem("Desktop", "Pop Desktop status")
	m.desktopDetail = m.desktop.AddSubMenuItem("Status", "")
	m.desktopDetail.Disable()
	m.desktopVersion = m.desktop.AddSubMenuItem("Version", "")
	m.desktopVersion.Disable()
	m.desktopPath = m.desktop.AddSubMenuItem("Path", "")
	m.desktopPath.Disable()
	m.checkDesktop = m.desktop.AddSubMenuItem("Check Again", "Check Pop Desktop")
	m.desktopAction = m.desktop.AddSubMenuItem("Install Pop Desktop…", "Install or update Pop Desktop")
	m.openDesktop = m.desktop.AddSubMenuItem("Open Pop Desktop", "Open Pop Desktop")

	m.cli = systray.AddMenuItem("CLI", "Pop CLI status")
	m.cliDetail = m.cli.AddSubMenuItem("Status", "")
	m.cliDetail.Disable()
	m.cliVersion = m.cli.AddSubMenuItem("Version", "")
	m.cliVersion.Disable()
	m.cliPath = m.cli.AddSubMenuItem("Path", "")
	m.cliPath.Disable()
	m.cliNodePath = m.cli.AddSubMenuItem("Node", "")
	m.cliNodePath.Disable()
	m.checkCLI = m.cli.AddSubMenuItem("Check Again", "Check Pop CLI")
	m.cliAction = m.cli.AddSubMenuItem("Update CLI…", "Install or update Pop CLI")

	m.node = systray.AddMenuItem("Node", "Node.js status")
	m.nodeDetail = m.node.AddSubMenuItem("Status", "")
	m.nodeDetail.Disable()
	m.nodeVersion = m.node.AddSubMenuItem("Version", "")
	m.nodeVersion.Disable()
	m.nodePath = m.node.AddSubMenuItem("Path", "")
	m.nodePath.Disable()
	m.checkNode = m.node.AddSubMenuItem("Check Again", "Check Node.js")

	systray.AddSeparator()
	m.checkUpdates = systray.AddMenuItem("Check for Updates…", "Check all Pop components")
	m.diagnostics = systray.AddMenuItem("Diagnostics…", "Show component diagnostics")
	m.startAtLogin = systray.AddMenuItemCheckbox("Start at Login", "Start when you sign in", false)
	systray.AddSeparator()
	m.quit = systray.AddMenuItem("Quit Pop Desktop", "Quit")

	bindWindowsClick(m.openDesktop, func(c Callbacks) func() { return c.OpenDesktop })
	bindWindowsClick(m.checkDesktop, func(c Callbacks) func() { return c.CheckDesktop })
	bindWindowsClick(m.desktopAction, func(c Callbacks) func() { return c.InstallDesktop })
	bindWindowsClick(m.checkUpdates, func(c Callbacks) func() { return c.CheckUpdates })
	bindWindowsClick(m.checkServer, func(c Callbacks) func() { return c.CheckServer })
	bindWindowsClick(m.checkNode, func(c Callbacks) func() { return c.CheckNode })
	bindWindowsClick(m.checkCLI, func(c Callbacks) func() { return c.CheckCLI })
	bindWindowsClick(m.cliAction, func(c Callbacks) func() { return c.UpdateCLI })
	bindWindowsClick(m.configure, func(c Callbacks) func() { return c.ConfigureServer })
	bindWindowsClick(m.diagnostics, func(c Callbacks) func() { return c.Diagnostics })
	bindWindowsClick(m.startAtLogin, func(c Callbacks) func() { return c.ToggleStartAtLogin })
	bindWindowsClick(m.quit, func(c Callbacks) func() { return c.Quit })
	return m
}

func bindWindowsClick(item *systray.MenuItem, selectCallback func(Callbacks) func()) {
	go func() {
		for range item.ClickedCh {
			windowsTray.Lock()
			callback := selectCallback(windowsTray.callbacks)
			windowsTray.Unlock()
			if callback != nil {
				callback()
			}
		}
	}()
}

func applyWindowsState(m windowsMenu, state MenuState) {
	m.server.SetIcon(statusIcon(state.ServerIndicator))
	m.desktop.SetIcon(statusIcon(state.DesktopIndicator))
	m.cli.SetIcon(statusIcon(state.CLIIndicator))
	m.node.SetIcon(statusIcon(state.NodeIndicator))

	setWindowsTitle(m.server, state.Server)
	setWindowsTitle(m.serverDetail, state.ServerDetail)
	setWindowsTitle(m.serverURL, state.ServerURL)
	setWindowsEnabled(m.checkServer, state.CheckServerEnabled)
	setWindowsEnabled(m.configure, state.ConfigureServerEnabled)

	setWindowsTitle(m.desktop, state.Desktop)
	setWindowsTitle(m.desktopDetail, state.DesktopDetail)
	setWindowsTitle(m.desktopVersion, state.DesktopVersion)
	setWindowsTitle(m.desktopPath, state.DesktopPath)
	setWindowsEnabled(m.checkDesktop, state.CheckDesktopEnabled)
	setWindowsTitle(m.desktopAction, state.DesktopActionTitle)
	setWindowsEnabled(m.desktopAction, state.InstallDesktopEnabled)
	setWindowsEnabled(m.openDesktop, state.OpenDesktopEnabled)

	setWindowsTitle(m.cli, state.CLI)
	setWindowsTitle(m.cliDetail, state.CLIDetail)
	setWindowsTitle(m.cliVersion, state.CLIVersion)
	setWindowsTitle(m.cliPath, state.CLIPath)
	setWindowsTitle(m.cliNodePath, state.CLINodePath)
	setWindowsEnabled(m.checkCLI, state.CheckCLIEnabled)
	setWindowsTitle(m.cliAction, state.CLIActionTitle)
	setWindowsEnabled(m.cliAction, state.UpdateCLIEnabled)

	setWindowsTitle(m.node, state.Node)
	setWindowsTitle(m.nodeDetail, state.NodeDetail)
	setWindowsTitle(m.nodeVersion, state.NodeVersion)
	setWindowsTitle(m.nodePath, state.NodePath)
	setWindowsEnabled(m.checkNode, state.CheckNodeEnabled)
	setWindowsEnabled(m.checkUpdates, state.CheckUpdatesEnabled)
	setWindowsEnabled(m.startAtLogin, state.StartAtLoginEnabled)
	if state.StartAtLogin {
		m.startAtLogin.Check()
	} else {
		m.startAtLogin.Uncheck()
	}
}

func statusIcon(indicator Indicator) []byte {
	switch indicator {
	case IndicatorGood:
		return goodStatusIcon
	case IndicatorWarning:
		return warningStatusIcon
	case IndicatorBad:
		return badStatusIcon
	default:
		return neutralStatusIcon
	}
}

func setWindowsTitle(item *systray.MenuItem, value string) {
	if value == "" {
		value = "—"
	}
	item.SetTitle(value)
}

func setWindowsEnabled(item *systray.MenuItem, enabled bool) {
	if enabled {
		item.Enable()
	} else {
		item.Disable()
	}
}
