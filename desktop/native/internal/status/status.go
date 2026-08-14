package status

// State values are domain enums rendered by the tray and native dialogs.
type State string

const (
	NotConfigured          State = "not_configured"
	NotInstalled           State = "not_installed"
	Checking               State = "checking"
	Connecting             State = "connecting"
	Connected              State = "connected"
	Offline                State = "offline"
	AuthenticationRequired State = "authentication_required"
	UpdateRequired         State = "update_required"
	Stopped                State = "stopped"
)

type Component struct {
	Label string `json:"label"`
	State State  `json:"state"`
	Text  string `json:"text"`
}

type Snapshot struct {
	Server  Component `json:"server"`
	Desktop Component `json:"desktop"`
	CLI     Component `json:"cli"`
	Node    Component `json:"node"`
}

func Initial() Snapshot {
	return Snapshot{
		Server:  Component{Label: "Pop Server", State: NotConfigured, Text: "Not configured"},
		Desktop: Component{Label: "Pop Desktop", State: NotInstalled, Text: "Not installed"},
		CLI:     Component{Label: "Pop CLI", State: Checking, Text: "Checking"},
		Node:    Component{Label: "Node", State: Checking, Text: "Checking"},
	}
}
