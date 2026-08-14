package desktopwindow

import (
	"net/url"
	"strings"
)

type navigationDisposition uint8

const (
	navigationBlocked navigationDisposition = iota
	navigationInternal
	navigationExternal
)

func navigationPolicy(serverURL, candidateURL string) navigationDisposition {
	server, serverErr := url.Parse(serverURL)
	candidate, candidateErr := url.Parse(candidateURL)
	if serverErr != nil || candidateErr != nil || server.Scheme == "" || server.Hostname() == "" || candidate.Scheme == "" {
		return navigationBlocked
	}
	if sameOrigin(server, candidate) {
		return navigationInternal
	}
	switch strings.ToLower(candidate.Scheme) {
	case "http", "https", "mailto", "tel":
		return navigationExternal
	default:
		return navigationBlocked
	}
}

func sameOrigin(left, right *url.URL) bool {
	return strings.EqualFold(left.Scheme, right.Scheme) &&
		strings.EqualFold(left.Hostname(), right.Hostname()) &&
		effectivePort(left) == effectivePort(right)
}

func effectivePort(value *url.URL) string {
	if port := value.Port(); port != "" {
		return port
	}
	switch strings.ToLower(value.Scheme) {
	case "http":
		return "80"
	case "https":
		return "443"
	default:
		return ""
	}
}
