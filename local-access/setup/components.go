package main

import "errors"

type Components struct {
	Desktop bool `json:"desktop"`
	CLI     bool `json:"cli"`
}

func (c Components) validate() error {
	if !c.Desktop && !c.CLI {
		return errors.New("Select Pop Agent Desktop, Pop Agent CLI, or both.")
	}
	return nil
}

// An unchecked component is not an uninstall request. Existing components
// remain installed during an additive upgrade/repair.
func (c Components) including(installed Components) Components {
	return Components{Desktop: c.Desktop || installed.Desktop, CLI: c.CLI || installed.CLI}
}
