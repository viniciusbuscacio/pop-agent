.PHONY: build build-setup test vet gate pack-desktop pack-setup clean

build:
	./build-darwin.sh

build-setup: build
	./build-setup-darwin.sh

test:
	# Several native lifecycle tests own process-wide resources and use short
	# deadlines; serialize packages so a cold Mac build cannot starve them.
	go test -p 1 ./...

vet:
	go vet ./...

gate: vet test build-setup
	@echo "Gate passed"

pack-desktop:
	./pack-desktop.sh

pack-setup: build-setup
	./pack-setup-darwin.sh

clean:
	rm -rf "build/bin/Pop Desktop Manager.app" "build/bin/Pop Desktop.app" "build/bin/Pop Desktop Setup.app"
