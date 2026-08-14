package tray

// Callbacks are invoked by the native menu. Implementations must return fast
// unless they intentionally present a modal native dialog.
type Callbacks struct {
	OpenDesktop        func()
	CheckDesktop       func()
	InstallDesktop     func()
	CheckUpdates       func()
	CheckServer        func()
	CheckNode          func()
	CheckCLI           func()
	UpdateCLI          func()
	ConfigureServer    func()
	Diagnostics        func()
	ToggleStartAtLogin func()
	Quit               func()
}

type Indicator int

const (
	IndicatorNeutral Indicator = iota
	IndicatorGood
	IndicatorWarning
	IndicatorBad
)

type MenuState struct {
	Server                 string
	ServerDetail           string
	ServerURL              string
	ServerIndicator        Indicator
	Desktop                string
	DesktopDetail          string
	DesktopVersion         string
	DesktopPath            string
	DesktopIndicator       Indicator
	CheckDesktopEnabled    bool
	InstallDesktopEnabled  bool
	DesktopActionTitle     string
	CLI                    string
	CLIDetail              string
	CLIVersion             string
	CLIPath                string
	CLINodePath            string
	CLIIndicator           Indicator
	CheckCLIEnabled        bool
	UpdateCLIEnabled       bool
	CLIActionTitle         string
	Node                   string
	NodeDetail             string
	NodeVersion            string
	NodePath               string
	NodeIndicator          Indicator
	CheckNodeEnabled       bool
	OpenDesktopEnabled     bool
	CheckUpdatesEnabled    bool
	CheckServerEnabled     bool
	ConfigureServerEnabled bool
	StartAtLogin           bool
	StartAtLoginEnabled    bool
}
