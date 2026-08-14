//go:build !darwin && !windows

package desktopwindow

import "fmt"

func install(serverURL string, _ SessionHandler) error { fmt.Println(serverURL); return nil }
func setServerURL(serverURL string)                    { fmt.Println(serverURL) }
func show()                                            {}
func run()                                             {}
func stop()                                            {}
func remove()                                          {}
func showFatal(message string)                         { fmt.Println(message) }
