//go:build windows

package main

import (
	"embed"
	"io/fs"
	"os"
	"slices"
	"strings"

	installer "github.com/viniciusbuscacio/go-installer/windows"
	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	wwindows "github.com/wailsapp/wails/v2/pkg/options/windows"
	"golang.org/x/sys/windows"
)

//go:embed assets/*
var frontend embed.FS

func main() {
	for _, arg := range os.Args[1:] {
		if strings.HasPrefix(arg, "--go-installer-cleanup=") {
			if validCleanup() {
				installer.MaybeCleanup()
			}
			return
		}
	}
	preview := slices.Contains(os.Args[1:], "--preview") || version == "dev"
	app := newSetup(preview)

	name, _ := windows.UTF16PtrFromString(`Local\PopAgentLocalAccessSetup`)
	if preview {
		name, _ = windows.UTF16PtrFromString(`Local\PopAgentLocalAccessSetupPreview`)
	}
	handle, err := windows.CreateMutex(nil, false, name)
	if err != nil {
		return
	}
	defer windows.CloseHandle(handle)
	if windows.GetLastError() == windows.ERROR_ALREADY_EXISTS {
		return
	}
	assets, _ := fs.Sub(frontend, "assets")
	err = wails.Run(&options.App{
		Title: "Pop Agent Setup", Width: 680, Height: 560, MinWidth: 600, MinHeight: 500,
		Frameless: true, DisableResize: false,
		BackgroundColour: &options.RGBA{R: 32, G: 32, B: 32, A: 255},
		AssetServer:      &assetserver.Options{Assets: assets},
		OnStartup:        app.startup, OnBeforeClose: app.beforeClose,
		Windows: &wwindows.Options{WebviewIsTransparent: false, WindowIsTranslucent: false, BackdropType: wwindows.None},
		Bind:    []interface{}{app},
	})
	if err != nil {
		os.Exit(1)
	}
}
