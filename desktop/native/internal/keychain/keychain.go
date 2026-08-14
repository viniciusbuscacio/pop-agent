package keychain

import "errors"

const (
	Service              = "com.popagent.desktop"
	legacyManagerService = "com.popagent.desktop-manager"
	legacyWailsService   = "com.wails.pop-desktop-manager"
)

var ErrNotFound = errors.New("keychain item not found")

type Store interface {
	Get(account string) (string, error)
	Set(account, token string) error
	Delete(account string) error
}

func New() Store { return newPlatformStore() }
