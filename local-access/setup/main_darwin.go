//go:build darwin

package main

import (
	"embed"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"io/fs"
	"os"
	"slices"
)

//go:embed assets/*
var frontend embed.FS

func main() {
	app := newSetup(slices.Contains(os.Args[1:], "--preview") || version == "dev")
	assets, _ := fs.Sub(frontend, "assets")
	err := wails.Run(&options.App{SingleInstanceLock: &options.SingleInstanceLock{UniqueId: "com.popagent.setup"},
		Title: "Pop Agent Setup", Width: 680, Height: 590, MinWidth: 600, MinHeight: 560,
		Frameless: true, BackgroundColour: &options.RGBA{R: 32, G: 32, B: 32, A: 255},
		AssetServer: &assetserver.Options{Assets: assets}, OnStartup: app.startup, OnBeforeClose: app.beforeClose,
		Mac: &mac.Options{}, Bind: []interface{}{app},
	})
	if err != nil {
		os.Exit(1)
	}
}
