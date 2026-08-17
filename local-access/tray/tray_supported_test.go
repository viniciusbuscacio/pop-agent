package main

import (
	"image/png"
	"os"
	"testing"
)

func TestStatusIconsStaySmallAndUseConnectedGreen(t *testing.T) {
	for _, test := range []struct {
		path      string
		wantRed   uint32
		wantGreen uint32
		wantBlue  uint32
	}{
		{path: "statusConnected.png", wantRed: 0x3434, wantGreen: 0xc7c7, wantBlue: 0x5959},
		{path: "statusNeutral.png", wantRed: 0x8e8e, wantGreen: 0x8e8e, wantBlue: 0x9393},
	} {
		file, err := os.Open(test.path)
		if err != nil {
			t.Fatal(err)
		}
		image, err := png.Decode(file)
		file.Close()
		if err != nil {
			t.Fatal(err)
		}
		if image.Bounds().Dx() != 32 || image.Bounds().Dy() != 32 {
			t.Fatalf("%s bounds = %v", test.path, image.Bounds())
		}
		red, green, blue, alpha := image.At(15, 15).RGBA()
		if red != test.wantRed || green != test.wantGreen || blue != test.wantBlue || alpha != 0xffff {
			t.Fatalf("%s center = %#x %#x %#x %#x", test.path, red, green, blue, alpha)
		}
		opaque := 0
		for y := 0; y < 32; y++ {
			for x := 0; x < 32; x++ {
				_, _, _, pixelAlpha := image.At(x, y).RGBA()
				if pixelAlpha != 0 {
					opaque++
				}
			}
		}
		if opaque < 440 || opaque > 500 {
			t.Fatalf("%s dot size = %d visible pixels", test.path, opaque)
		}
	}
}
