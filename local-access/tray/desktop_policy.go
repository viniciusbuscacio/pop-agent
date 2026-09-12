package main

import (
	"net/url"
	"strings"
)

// Only the configured origin is hosted. External HTTPS pages use the browser;
// file, javascript, custom protocols and URLs containing credentials are blocked.
func desktopNavigation(origin, target string) (internal, external bool) {
	a, err := url.Parse(origin)
	if err != nil || !validLoginURL(origin) {
		return false, false
	}
	b, err := url.Parse(target)
	if err != nil || b.User != nil || b.Host == "" {
		return false, false
	}
	port := func(u *url.URL) string {
		if u.Port() != "" {
			return u.Port()
		}
		if u.Scheme == "https" {
			return "443"
		}
		return "80"
	}
	if strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Hostname(), b.Hostname()) && port(a) == port(b) {
		return true, false
	}
	return false, b.Scheme == "https"
}
