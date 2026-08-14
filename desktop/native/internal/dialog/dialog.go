package dialog

// PromptServer asks for the server origin and password. Password is returned
// only to the caller and must never be persisted or logged.
func PromptServer(currentURL string) (serverURL, password string, ok bool) {
	return promptServer(currentURL)
}

func Confirm(title, message, acceptTitle string) bool {
	return confirm(title, message, acceptTitle)
}

func ShowInfo(title, message string)  { showInfo(title, message) }
func ShowError(title, message string) { showError(title, message) }
