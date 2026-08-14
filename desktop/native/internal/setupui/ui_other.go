//go:build !darwin

package setupui

func welcome() bool                             { return false }
func askCredentials(string) (Credentials, bool) { return Credentials{}, false }
func beginProgress()                            {}
func runProgress()                              {}
func setProgress(string)                        {}
func finishProgress()                           {}
func showError(string)                          {}
func showSuccess() bool                         { return false }
