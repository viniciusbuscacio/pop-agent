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
		if image.Bounds().Dx() != 16 || image.Bounds().Dy() != 16 {
			t.Fatalf("%s bounds = %v", test.path, image.Bounds())
		}
		red, green, blue, alpha := image.At(7, 7).RGBA()
		if red != test.wantRed || green != test.wantGreen || blue != test.wantBlue || alpha != 0xffff {
			t.Fatalf("%s center = %#x %#x %#x %#x", test.path, red, green, blue, alpha)
		}
		opaque := 0
		for y := 0; y < 16; y++ {
			for x := 0; x < 16; x++ {
				_, _, _, pixelAlpha := image.At(x, y).RGBA()
				if pixelAlpha != 0 {
					opaque++
				}
			}
		}
		if opaque < 40 || opaque > 55 {
			t.Fatalf("%s dot size = %d opaque pixels", test.path, opaque)
		}
	}
}
