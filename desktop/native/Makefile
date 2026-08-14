.PHONY: build test vet gate pack-desktop clean

build:
	./build-darwin.sh

test:
	go test ./...

vet:
	go vet ./...

gate: vet test build
	@echo "Gate passed"

pack-desktop:
	./pack-desktop.sh

clean:
	rm -rf "build/bin/Pop Desktop Manager.app" "build/bin/Pop Desktop.app"
