package setupui

type Credentials struct {
	ServerURL string
	Password  string
}

func Welcome() bool                                       { return welcome() }
func AskCredentials(serverURL string) (Credentials, bool) { return askCredentials(serverURL) }
func BeginProgress()                                      { beginProgress() }
func RunProgress()                                        { runProgress() }
func SetProgress(message string)                          { setProgress(message) }
func FinishProgress()                                     { finishProgress() }
func ShowError(message string)                            { showError(message) }
func ShowSuccess() bool                                   { return showSuccess() }
